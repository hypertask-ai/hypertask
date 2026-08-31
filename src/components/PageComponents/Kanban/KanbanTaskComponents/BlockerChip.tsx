import UserAvatar from '@/components/Common/UserAvatar';

export type BlockerUser = {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};

const BlockerChip = ({ user }: { user: BlockerUser }) => {
  const name = user.displayName?.trim() || user.email?.trim() || "Unknown person";
  return (
    <span className="inline-flex h-labelComponent max-w-full items-center gap-1 rounded-[4px] bg-[hsl(0_62.8%_30.6%)] px-1.5 text-micro font-semibold leading-none text-white">
      <UserAvatar
        alt=""
        fallbackClassName="bg-white/20 text-white"
        name={name}
        photoURL={user.photoURL}
        size={16}
        title={name}
      />
      <span className="truncate">{name}</span>
    </span>
  );
};

export default BlockerChip;
