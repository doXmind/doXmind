"use client";

import { motion } from "framer-motion";

interface FeatureCalloutProps {
  label: string;
  className?: string;
  delay?: number;
}

export function FeatureCallout({ label, className, delay = 0 }: FeatureCalloutProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.8 + delay }}
    >
      <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary shadow-sm">
        {label}
      </span>
    </motion.div>
  );
}
