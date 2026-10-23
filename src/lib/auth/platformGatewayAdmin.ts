const PLATFORM_GATEWAY_ADMIN = {
  userId: 6,
  email: 'valentin.yeo@gmail.com',
} as const

export function isPlatformGatewayAdmin(user: { id: number; email: string }) {
  return user.id === PLATFORM_GATEWAY_ADMIN.userId &&
    user.email.trim().toLowerCase() === PLATFORM_GATEWAY_ADMIN.email
}
