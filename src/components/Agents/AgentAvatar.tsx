import UserAvatar from "@/components/Common/UserAvatar";

interface AgentAvatarProps {
  /** Seeds the generated avatar; falls back to initials if missing. */
  agentId?: string | null;
  name?: string | null;
  /** A custom uploaded photo, if any — always wins over the generated avatar. */
  photoURL?: string | null;
  size: number;
  className?: string;
}

/**
 * Every agent gets a distinct, deterministic robot-face avatar (DiceBear
 * bottts-neutral, seeded by agent id) instead of initials. A custom uploaded
 * photo still takes priority. See HTPR-6034.
 */
export default function AgentAvatar({
  agentId,
  name,
  photoURL,
  size,
  className,
}: AgentAvatarProps) {
  return (
    <UserAvatar
      agentId={agentId}
      name={name}
      photoURL={photoURL}
      size={size}
      className={className}
      fallbackClassName={className}
    />
  );
}
