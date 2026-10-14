import UserAvatar from "@/components/Common/UserAvatar";

interface AgentAvatarProps {
  agentId?: string | null;
  name?: string | null;
  photoURL?: string | null;
  size: number;
  className?: string;
}

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
