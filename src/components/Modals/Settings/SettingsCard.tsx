import { ReactNode } from "react";

interface SettingsCardProps {
  children: ReactNode;
  title?: string;
}

const SettingsCard: React.FC<SettingsCardProps> = ({ children, title }) => {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <h3 className="text-meta font-semibold uppercase tracking-wide text-text-light-gray">
          {title}
        </h3>
      )}
      <div className="flex flex-col gap-3 text-dense text-white-black [&_.d-flex]:!text-dense [&_h3]:!text-dense [&_h3]:!font-semibold">
        {children}
      </div>
    </section>
  );
};

export default SettingsCard;
