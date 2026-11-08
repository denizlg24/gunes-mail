import { useState } from "react";
import { cn } from "@/lib/utils";

import { useContactPhoto } from "@/hooks/use-contacts";
import { avatarColor, initials } from "@/lib/format";

interface PersonAvatarProps {
  name: string;
  email: string;
  picture?: string | null;
  size?: number;
  className?: string;
}

export function PersonAvatar({ name, email, picture, size = 32, className }: PersonAvatarProps) {
  const [failed, setFailed] = useState(false);
  const contactPhoto = useContactPhoto(picture ? undefined : email);
  const src = picture ?? contactPhoto;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        draggable={false}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={style}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        className,
      )}
      style={{ ...style, backgroundColor: avatarColor(email || name) }}
    >
      {initials(name || email)}
    </span>
  );
}
