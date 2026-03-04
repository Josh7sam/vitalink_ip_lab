import type { Response } from 'express'

type StreamEnvelope = {
  event: string
  data: unknown
}

const userStreams = new Map<string, Set<Response>>()

const toJson = (value: unknown) => JSON.stringify(value)

const writeSseEvent = (res: Response, envelope: StreamEnvelope) => {
  res.write(`event: ${envelope.event}\n`)
  res.write(`data: ${toJson(envelope.data)}\n\n`)
}

const removeClient = (userId: string, res: Response) => {
  const streams = userStreams.get(userId)
  if (!streams) return
  streams.delete(res)
  if (streams.size === 0) {
    userStreams.delete(userId)
  }
}

export function registerUserNotificationStream(userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const streams = userStreams.get(userId) ?? new Set<Response>()
  streams.add(res)
  userStreams.set(userId, streams)

  writeSseEvent(res, {
    event: 'connected',
    data: { connected: true, timestamp: new Date().toISOString() }
  })

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat)
      removeClient(userId, res)
      return
    }
    res.write(': ping\n\n')
  }, 25000)

  const cleanup = () => {
    clearInterval(heartbeat)
    removeClient(userId, res)
  }

  res.on('close', cleanup)
  res.on('error', cleanup)

  return cleanup
}

export function publishNotificationToUser(userId: string, event: string, data: unknown) {
  const streams = userStreams.get(userId)
  if (!streams || streams.size === 0) return

  for (const res of streams) {
    if (res.writableEnded || res.destroyed) {
      removeClient(userId, res)
      continue
    }

    try {
      writeSseEvent(res, { event, data })
    } catch {
      removeClient(userId, res)
    }
  }
}

