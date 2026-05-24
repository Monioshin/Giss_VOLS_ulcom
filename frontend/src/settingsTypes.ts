export type BackupEntry = { id: string; filename: string; size_bytes: number; created_at: string }
export type BackupConfig = { enabled: boolean; intervalMinutes: number; maxBackups: number }
export type AppConfig = { userDataReadOnly: boolean }
