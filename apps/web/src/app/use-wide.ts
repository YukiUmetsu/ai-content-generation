import { useEffect, useState } from "react";

export function useWide(breakpoint = 1024) {
  const [wide, setWide] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= breakpoint : true));

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [breakpoint]);

  return wide;
}
