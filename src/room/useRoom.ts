import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionType, AthleteSide, JudgeSeat, MatchState, PressOutcome } from '../types'
import type { MatchCommand } from '../match/matchCore'
import { canAcceptScore, reduceMatch } from '../match/matchCore'
import { submitJudgePress, type JudgePress } from '../pairing/pairingEngine'
import { getRuleSet } from '../rules/ruleSets'
import { createRoomChannel, expectedTransport, type RoomChannel } from './roomChannel'
import type { RoomTransport } from './roomChannel'
import { loadRoom, saveRoom, getDeviceId } from './roomStorage'
import { offsetSample, smoothClockOffset } from './clock'
import type { DevicePresence, RoomConfig, RoomMessage, RoomRole, RoomSnapshot } from './roomTypes'
import {
  HOST_TIMEOUT_MS,
  PRESENCE_PING_MS,
  PRESENCE_TIMEOUT_MS,
  STATE_HEARTBEAT_MS,
} from './roomTypes'

/* ================================================================== */
/* 主控端：持有房間狀態，扮演伺服器                                    */
/* ================================================================== */

export interface RoomHostApi {
  config: RoomConfig | null
  /** 尚未建立比賽時為 null（主控端會先顯示設定畫面） */
  state: MatchState | null
  presences: DevicePresence[]
  transport: RoomTransport
  /** 傳輸層是否已就緒 */
  ready: boolean
  dispatch: (command: MatchCommand) => void
  /** 建立（或重建）這個房間的比賽 */
  initialize: (config: RoomConfig, match: MatchState) => void
  /** 調整房間設定（例如切換單／雙裁判），會立即廣播給其他端 */
  updateConfig: (patch: Partial<RoomConfig>) => void
}

/**
 * 主控端 hook。
 *
 * 這台裝置就是這場比賽的唯一權威：所有裁判按鍵送到這裡，
 * 由 pairingEngine 判定後才寫入正式比分，再把完整狀態廣播出去。
 * 電視端與裁判端只能接收，不能自行改分數。
 * 這個責任分工與未來改用 Supabase RPC 時完全相同。
 */
export function useRoomHost(roomCode: string): RoomHostApi {
  const stored = useMemo(() => loadRoom(roomCode), [roomCode])
  const [config, setConfig] = useState<RoomConfig | null>(stored?.config ?? null)
  const [state, setState] = useState<MatchState | null>(stored?.match ?? null)
  const [presences, setPresences] = useState<DevicePresence[]>([])
  const [ready, setReady] = useState(false)
  const pressesRef = useRef<JudgePress[]>([])

  /*
   * 連線本身由下方的 effect 建立與釋放，這裡只留一個參考給事件處理使用。
   * 不可以用 useMemo 建立連線：那樣「建立」與「關閉」的時機會對不起來，
   * StrictMode 的重複掛載會留下一個已關閉的頻道，畫面就永遠連不上。
   */
  const channelRef = useRef<RoomChannel | null>(null)
  const send = useCallback((message: RoomMessage): void => {
    channelRef.current?.send(message)
  }, [])

  /*
   * 供訂閱回呼取用最新值，避免每次狀態改變都重建訂閱而漏掉訊息。
   * 這個 effect 必須宣告在廣播與訂閱的 effect 之前，
   * React 會依宣告順序執行，確保它們讀到的一定是本次 render 的值。
   */
  const configRef = useRef(config)
  const stateRef = useRef(state)
  const presencesRef = useRef(presences)
  useEffect(() => {
    configRef.current = config
    stateRef.current = state
    presencesRef.current = presences
  }, [config, state, presences])

  const broadcast = useCallback((): void => {
    const currentConfig = configRef.current
    const currentState = stateRef.current
    if (currentConfig === null || currentState === null) return
    const snapshot: RoomSnapshot = {
      roomCode: currentConfig.roomCode,
      sentAt: Date.now(),
      config: currentConfig,
      match: currentState,
      presences: presencesRef.current,
    }
    send({ type: 'STATE', snapshot })
  }, [send])

  const dispatch = useCallback((command: MatchCommand) => {
    setState((current) => {
      if (current === null) return current
      const result = reduceMatch(current, command, Date.now())
      if (result.rejected !== undefined) return current
      const currentConfig = configRef.current
      if (currentConfig !== null) saveRoom(currentConfig, result.state)
      return result.state
    })
  }, [])

  const initialize = useCallback((nextConfig: RoomConfig, nextMatch: MatchState) => {
    saveRoom(nextConfig, nextMatch)
    pressesRef.current = []
    setConfig(nextConfig)
    setState(nextMatch)
  }, [])

  const updateConfig = useCallback((patch: Partial<RoomConfig>) => {
    setConfig((current) => {
      if (current === null) return current
      const next = { ...current, ...patch }
      const currentState = stateRef.current
      if (currentState !== null) saveRoom(next, currentState)
      return next
    })
  }, [])

  /* 處理來自裁判與顯示端的訊息 */
  const handleMessage = useCallback(
    (message: RoomMessage) => {
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
        // 新裝置上線立刻補一次完整狀態，不必等下一次心跳
        if (message.type === 'HELLO') broadcast()
        return
      }

      if (message.type !== 'PRESS') return

      const currentConfig = configRef.current
      const currentState = stateRef.current
      if (currentConfig === null || currentState === null) return

      const now = Date.now()
      const rules = getRuleSet(currentState.config.ruleSetCode)
      const gate = canAcceptScore(currentState)
      const required = currentConfig.judgeMode === 'SINGLE' ? 1 : 2

      const result = submitJudgePress(
        {
          presses: pressesRef.current,
          confirmationWindowMs: currentConfig.confirmationWindowMs,
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
        send({
          type: 'PRESS_RESULT',
          deviceId: member.deviceId,
          clientEventId: message.input.clientEventId,
          outcome: result.outcome,
        })
      }
    },
    [send, dispatch, broadcast],
  )

  /*
   * 建立連線。宣告在廣播的 effect 之前，
   * 確保第一次掛載時 channelRef 已就位，開場狀態不必等到下一次心跳。
   */
  useEffect(() => {
    const channel = createRoomChannel(roomCode)
    channelRef.current = channel
    const detachReady = channel.onReady(setReady)
    const detachMessage = channel.subscribe(handleMessage)
    return () => {
      detachReady()
      detachMessage()
      channel.close()
      channelRef.current = null
      setReady(false)
    }
  }, [roomCode, handleMessage])

  /* 狀態改變就立刻廣播 */
  useEffect(() => {
    broadcast()
  }, [state, config, presences, broadcast])

  /* 心跳：讓晚加入的裝置立刻看到比分，也提供時鐘校正樣本 */
  useEffect(() => {
    const id = window.setInterval(broadcast, STATE_HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [broadcast])

  /* 清掉逾時未回報的裝置 */
  useEffect(() => {
    const id = window.setInterval(() => {
      setPresences((current) =>
        current.filter((p) => Date.now() - p.lastSeenAt < PRESENCE_TIMEOUT_MS),
      )
    }, PRESENCE_PING_MS)
    return () => window.clearInterval(id)
  }, [])

  return {
    config,
    state,
    presences,
    transport: expectedTransport(),
    ready,
    dispatch,
    initialize,
    updateConfig,
  }
}

/* ================================================================== */
/* 裁判端與電視端                                                      */
/* ================================================================== */

export interface RoomClientApi {
  snapshot: RoomSnapshot | null
  /** 主控端是否在線（收得到正式狀態） */
  connected: boolean
  transport: RoomTransport
  /** 傳輸層是否已就緒；cloud 模式下為 false 代表連不上 Supabase */
  ready: boolean
  /** 主控端時間 ≈ 本機 Date.now() + clockOffsetMs */
  clockOffsetMs: number
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
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [lastStateAt, setLastStateAt] = useState<number>(0)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [ready, setReady] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<string, PressOutcome>>({})
  const offsetRef = useRef<number | null>(null)

  /* 連線的建立與釋放都在下方 effect 內；見主控端 hook 的說明 */
  const channelRef = useRef<RoomChannel | null>(null)

  const handleMessage = useCallback(
    (message: RoomMessage) => {
      if (message.type === 'STATE') {
        // 正式狀態一律以主控端為準，直接覆蓋本機
        const receivedAt = Date.now()
        setSnapshot(message.snapshot)
        setLastStateAt(receivedAt)
        const next = smoothClockOffset(
          offsetRef.current,
          offsetSample(message.snapshot.sentAt, receivedAt),
        )
        offsetRef.current = next
        setClockOffsetMs(next)
        return
      }
      if (message.type === 'PRESS_RESULT' && message.deviceId === deviceId) {
        setOutcomes((current) => ({ ...current, [message.clientEventId]: message.outcome }))
      }
    },
    [deviceId],
  )

  useEffect(() => {
    const channel = createRoomChannel(roomCode)
    channelRef.current = channel
    const detachReady = channel.onReady(setReady)
    const detachMessage = channel.subscribe(handleMessage)

    channel.send({ type: 'HELLO', deviceId, role, judgeSeat })
    const ping = window.setInterval(() => {
      channel.send({ type: 'PING', deviceId, role, judgeSeat })
    }, PRESENCE_PING_MS)

    return () => {
      detachReady()
      detachMessage()
      window.clearInterval(ping)
      channel.close()
      channelRef.current = null
      setReady(false)
    }
  }, [roomCode, deviceId, role, judgeSeat, handleMessage])

  /* 主控端超過一段時間沒有廣播就視為斷線；此時不得假裝送分成功 */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])
  const connected = lastStateAt > 0 && now - lastStateAt < HOST_TIMEOUT_MS

  const sendPress = useCallback(
    (side: AthleteSide, action: ActionType): string | null => {
      if (!connected || snapshot === null || judgeSeat === null) return null
      const clientEventId = `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      channelRef.current?.send({
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
    [connected, deviceId, judgeSeat, snapshot],
  )

  return {
    snapshot,
    connected,
    transport: expectedTransport(),
    ready,
    clockOffsetMs,
    deviceId,
    sendPress,
    outcomes,
  }
}
