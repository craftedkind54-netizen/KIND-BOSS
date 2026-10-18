export function isOwnedApplicationPanel(message, botUserId) {
  return Boolean(message && botUserId && message.author?.id === botUserId);
}
