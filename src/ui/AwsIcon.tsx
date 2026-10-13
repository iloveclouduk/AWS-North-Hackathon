import { iconPath } from '@/world/icons';

/** The official AWS Architecture Icon for a service (hidden when WXT_OFFICIAL_ICONS=false or not downloaded). */
export function AwsIcon({ serviceId, size = 20, className = '' }: { serviceId: string; size?: number; className?: string }) {
  const src = iconPath(serviceId);
  if (!src) return null;
  return <img className={`aws-icon ${className}`} src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
