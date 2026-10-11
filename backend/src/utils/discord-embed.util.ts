export function boundedEmbedDescription(description: string): string {
  if (description.length <= 4096) return description;
  const notice = '\n\n…Additional role details were omitted to fit this message. Your assigned roles are visible in Discord.';
  const prefix = description.slice(0, 4096 - notice.length);
  const lastLine = prefix.lastIndexOf('\n');
  return (lastLine > 0 ? prefix.slice(0, lastLine) : prefix) + notice;
}
