"use client";

import { motion } from "framer-motion";

/**
 * Wraps every page in a subtle fade/rise on navigation so route changes feel
 * like transitions, not hard reloads. `template.tsx` (vs `layout.tsx`) re-mounts
 * per navigation, which is what drives the animation. Reduced-motion is honored
 * via the app-wide MotionConfig, so this is a no-op for users who opt out.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
