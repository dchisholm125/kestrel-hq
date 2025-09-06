import * as fs from 'fs'
import * as path from 'path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export class Logger {
  private prefix?: string
  private logDir: string = 'logs'
  private maxTotalSizeBytes: number = 536870912 // 0.5GB

  constructor(prefix?: string) {
    this.prefix = prefix
    this.ensureLogDir()
  }

  private ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }

  private getLogFilePath(): string {
    const now = new Date()
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '') // e.g., 2025-09-05T14-30-00
    return path.join(this.logDir, `logger_${timestamp}.jsonl`)
  }

  private writeToFile(level: LogLevel, message: string, data?: any) {
    const logEntry = this.format(level, message, data) + '\n'
    const filePath = this.getLogFilePath()
    fs.appendFileSync(filePath, logEntry)
    this.rotateLogsIfNeeded()
  }

  private rotateLogsIfNeeded() {
    const files = fs.readdirSync(this.logDir).filter(f => f.startsWith('logger_')).map(f => ({
      name: f,
      path: path.join(this.logDir, f),
      stat: fs.statSync(path.join(this.logDir, f))
    })).sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime()) // oldest first

    let totalSize = files.reduce((sum, f) => sum + f.stat.size, 0)
    while (totalSize > this.maxTotalSizeBytes && files.length > 0) {
      const oldest = files.shift()!
      fs.unlinkSync(oldest.path)
      totalSize -= oldest.stat.size
    }
  }

  private format(level: LogLevel, message: string, data?: any) {
    const payload: any = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }
    if (this.prefix) payload.logger = this.prefix
    if (data !== undefined) payload.data = data
    return JSON.stringify(payload)
  }

  info(message: string, data?: any) {
    console.log(this.format('INFO', message, data))
    this.writeToFile('INFO', message, data)
  }

  warn(message: string, data?: any) {
    console.warn(this.format('WARN', message, data))
    this.writeToFile('WARN', message, data)
  }

  error(message: string, data?: any) {
    console.error(this.format('ERROR', message, data))
    this.writeToFile('ERROR', message, data)
  }

  debug(message: string, data?: any) {
    // keep debug as console.log for simplicity
    console.log(this.format('DEBUG', message, data))
    this.writeToFile('DEBUG', message, data)
  }
}

export default Logger
