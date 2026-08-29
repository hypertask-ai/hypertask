interface NotificationCountBadgeProps {
  count: number;
  hasUnseen: boolean;
  showSeenCount?: boolean;
}

const NotificationCountBadge = ({
  count,
  hasUnseen,
  showSeenCount = true,
}: NotificationCountBadgeProps) => {
  if (count <= 0) return null;

  if (hasUnseen) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-[#FE525A] text-[10px] font-bold leading-[14.52px] text-white">
        {count}
      </span>
    );
  }

  return showSeenCount ? (
    <span className="mt-[2px] text-[12px] text-white-black">{count}</span>
  ) : null;
};

export default NotificationCountBadge;
