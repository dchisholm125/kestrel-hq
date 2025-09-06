import { promises as fs } from 'fs'
import path from 'path'

/**
 * FileLogger
 * Lightweight JSONL logger for protocol events.
 * Each call appends a single line JSON object to the target file.
 */
class FileLogger {
  private static instance: FileLogger
  private baseDir: string

  private constructor(baseDir?: string) {
    this.baseDir = baseDir || '/home/ubuntu/Kestrel-HQ/logs'
  }

  public static getInstance(baseDir?: string): FileLogger {
    if (!FileLogger.instance) FileLogger.instance = new FileLogger(baseDir)
    return FileLogger.instance
  }

  /** Ensure logs directory exists */
  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true })
    } catch (e) {
      // Log mkdir errors to help debug
      console.error('[FileLogger] mkdir error', { baseDir: this.baseDir, err: (e as any)?.message || e })
      throw e // Re-throw to prevent silent failure
    }
  }

  private async writeLine(filename: string, type: string, data: Record<string, unknown>): Promise<void> {
    try {
      await this.ensureDir()
      const filePath = path.join(this.baseDir, filename)
      const entry = {
        timestamp: new Date().toISOString(),
        type,
  ...data
      }
      const line = JSON.stringify(entry)
      await fs.appendFile(filePath, line + '\n')
    } catch (e) {
      // Last resort: surface write errors to stderr so they are not silent
      // eslint-disable-next-line no-console
      console.error('[FileLogger] write error', { filename, err: (e as any)?.message || e })
    }
  }

  /** Log an accepted submission (guardian ACCEPT) */
  public async logSuccess(data: Record<string, unknown>): Promise<void> {
  return this.writeLine('success_log.jsonl', 'success', data)
  }

  /** Log a rejected submission (guardian REJECT) */
  public async logRejection(data: Record<string, unknown>): Promise<void> {
  return this.writeLine('rejected_log.jsonl', 'rejection', data)
  }

  /** Log a simulation failure (guardian error) */
  public async logFailure(data: Record<string, unknown>): Promise<void> {
  return this.writeLine('failure_log.jsonl', 'failure', data)
  }
}

export default FileLogger
export { FileLogger }
