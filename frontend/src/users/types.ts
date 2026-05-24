export type UserRole = 'ADMIN' | 'ARCHITECT' | 'USER'

export type UserRow = {
  id: number
  username: string
  role: UserRole
  created_at: string
}

export type UserRoleFilter = 'ALL' | UserRole
export type UserSortKey = 'username' | 'id' | 'created_at'
