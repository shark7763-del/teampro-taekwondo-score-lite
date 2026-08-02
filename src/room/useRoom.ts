import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionType, AthleteSide, JudgeSeat, MatchState, PressOutcome } from '../types'
import type { MatchCommand } from '../match/matchCore'
import { canAcceptScore, createMatchState, reduceMatch } from '../match/matchCore'
import { submitJudgePress, type JudgePress } from '../pairing/pairingEngine'
import { getRuleSet } from '../rules/ruleSets'
import { createRoomChannel } from './roomChannel'
import { loadRoom, saveRoom, getDeviceId } from './roomStorage'
import type { DevicePresence, RoomConfig, RoomRole, RoomSnapshot } from './roomTypes'
import { PRESENCE_PING_MS, PRESENCE_TIMEOUT_MS } from './roomTypes'

/* ================================================================== */
/* 主控端：本機模擬伺服器                                              */
/* ================================================================== */

export interface RoomHostApi {
  config: RoomConfig | null
  state: MatchState
  presences: DevicePresence[]
  dispatch: (command: MatchCommand) => void
  notFound: boolean
}

/**
 * 主控端 hook：在 mock 模式下扮演「伺服器」。
 *
 * 所有裁判按鍵都送到這裡，由 pairingEngine 判定後才更新正式比分，
 * 裁判端與電視端都只能接收廣播出去的狀態，不能自行改分數。
 * 這個責任分工與第三階段的 Supabase RPC 完全相同。
 */
export function useRoomHost(roomCode: string): RoomHostApi {
  const stored = useMemo(() => loadRoom(roomCode), [roomCode])
  const [config] = useState<RoomConfig | null>(stored?.config ?? null)
  const [state, setState] = useState<MatchState>(() => stored?.match ?? createMatchState())
  const [presences, setPresences] = useState<DevicePresence[]>([])
  const pressesRef = useRef<JudgePress[]>([])
  const stateRef = useRef(state)

  const channel = useMemo(() => createRoomChannel(roomCode), [roomCode])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const broadcast = useCallback(
    (next: MatchState, nextPresences: DevicePresence[]) => {
      if (config === null) return
      const snapshot: RoomSnapshot = {
        roomCode: config.roomCode,
        sentAt: Date.now(),
        config,
        match: next,
        presences: nextPresences,
      }
      channel.send({ type: 'STATE', snapshot })
    },
    [channel, config],
  )

  const dispatch = useCallback(
    (command: MatchCommand) => {
      setState((current) => {
        const result = reduceMatch(current, command, Date.now())
        if (result.rejected !== undefined) return current
        if (config !== null) saveRoom(config, result.state)
        return result.state
      })
    },
    [config],
  )

  /* 每次正式狀態改變就廣播，並保存 */
  useEffect(() => {
    broadcast(state, presences)
  }, [state, presences, broadcast])

  /* 處理來自裁判與顯示端的訊息 */
  useEffect(() => {
    if (config === null) return
    const unsubscribe = channel.subscribe((message) => {
      if (message.type === 'HELLO' || message.type === 'PING') {
        setPresences((current) => {
          const others = current.filter((p) => p.deviceId !== message.deviceId)
          return [
            ...others,
            {
              deviceId: message.deviceId,
              role: message.role,
              judgeSeat: message.judgeSeat,
              lastSeenAt: Date.now(),
            },
          ]
        })
        if (message.type === 'HELLO') broadcast(stateRef.current, [])
        return
      }

      if (message.type !== 'PRESS') return

      const now = Date.now()
      const rules = getRuleSet(stateRef.current.config.ruleSetCode)
      const gate = canAcceptScore(stateRef.current)
      const required = config.judgeMode === 'SINGLE' ? 1 : 2

      const result = submitJudgePress(
        {
          presses: pressesRef.current,
          confirmationWindowMs: config.confirmationWindowMs,
          requiredConfirmations: required,
          cooldownMs: rules.trainingDefaults.pressCooldownMs,
          maxPressesPerSecond: rules.trainingDefaults.maxPressesPerSecond,
          now,
          matchAcceptsScore: gate.ok,
          ...(gate.ok ? {} : { matchRejection: gate.reason }),
        },
        message.input,
      )
      pressesRef.current = result.presses

      if (result.outcome.status === 'MATCHED') {
        dispatch({
          type: 'SCORE',
          side: message.input.athleteSide,
          action: message.input.actionType,
          source: required === 1 ? 'JUDGE_SINGLE' : 'JUDGE_PAIR',
          matchedGroupId: result.outcome.matchedGroupId,
        })
      }

      // 只回覆給送出的裝置，且不揭露另一位裁判按了哪一方或哪一種技術
      for (const member of result.matchedGroup.length > 0
        ? result.matchedGroup
        : [{ deviceId: message.input.deviceId }]) {
        channel.send({
          type: 'PRESS_RESULT',
          deviceId: member.deviceId,
          clientEventId: message.input.clientEventId,
          outcome: result.outcome,
        })
      }
    })
    return unsubscribe
  }, [channel, config, dispatch, broadcast])

  /* 清掉逾時未回報的裝置 */
  useEffect(() => {
    const id = window.setInterval(() => {
      setPresences((current) =>
        current.filter((p) => Date.now() - p.lastSeenAt < PRESENCE_TIMEOUT_MS),
      )
    }, PRESENCE_PING_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => () => channel.close(), [channel])

  return { config, state, presences, dispatch, notFound: stored === null }
}

/* ================================================================== */
/* 裁判端與電視端                                                      */
/* ================================================================== */

export interface RoomClientApi {
  snapshot: RoomSnapshot | null
  /** 主控端是否在線（收得到正式狀態） */
  connected: boolean
  deviceId: string
  sendPress: (side: AthleteSide, action: ActionType) => string | null
  /** 依 clientEventId 查詢本機送出的按鍵目前結果 */
  outcomes: Record<string, PressOutcome>
}

export function useRoomClient(
  roomCode: string,
  role: RoomRole,
  judgeSeat: JudgeSeat | null,
): RoomClientApi {
  const deviceId = useMemo(() => getDeviceId(), [])
  const channel = useMemo(() => createRoomChannel(roomCode), [roomCode])
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [lastStateAt, setLastStateAt] = useState<number>(0)
  const [outcomes, setOutcomes] = useState<Record<string, PressOutcome>>({})

  useEffect(() => {
    const unsubscribe = channel.subscribe((message) => {
      if (message.type === 'STATE') {
        // 正式狀態一律以主控端為準，直接覆蓋本機
        setSnapshot(message.snapshot)
        setLastStateAt(Date.now())
        return
      }
      if (message.type === 'PRESS_RESULT' && message.deviceId === deviceId) {
        setOutcomes((current) => ({ ...current, [message.clientEventId]: message.outcome }))
      }
    })

    channel.send({ type: 'HELLO', deviceId, role, judgeSeat })
    const ping = window.setInterval(() => {
      channel.send({ type: 'PING', deviceId, role, judgeSeat })
    }, PRESENCE_PING_MS)

    return () => {
      unsubscribe()
      window.clearInterval(ping)
      channel.close()
    }
  }, [channel, deviceId, role, judgeSeat])

  /* 主控端超過一段時間沒有廣播就視為斷線；此時不得假裝送分成功 */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])
  const connected = lastStateAt > 0 && now - lastStateAt < PRESENCE_TIMEOUT_MS * 2

  const sendPress = useCallback(
    (side: AthleteSide, action: ActionType): string | null => {
      if (!connected || snapshot === null || judgeSeat === null) return null
      const clientEventId = `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      channel.send({
        type: 'PRESS',
        input: {
          clientEventId,
          matchId: snapshot.match.config.matchId,
          deviceId,
          judgeSeat,
          athleteSide: side,
          actionType: action,
        },
      })
      return clientEventId
    },
    [channel, connected, deviceId, judgeSeat, snapshot],
  )

  return { snapshot, connected, deviceId, sendPress, outcomes }
}
