export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export class Logger {
  private prefix?: string

  constructor(prefix?: string) {
    this.prefix = prefix
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
  }

  warn(message: string, data?: any) {
    console.warn(this.format('WARN', message, data))
  }

  error(message: string, data?: any) {
    console.error(this.format('ERROR', message, data))
  }

  debug(message: string, data?: any) {
    // keep debug as console.log for simplicity
    console.log(this.format('DEBUG', message, data))
  }
}

export default Logger
