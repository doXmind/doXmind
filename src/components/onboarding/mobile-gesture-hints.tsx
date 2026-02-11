"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Hand, MessageSquare, Mic } from "lucide-react";

const STORAGE_KEY = "doxmind-mobile-hints-seen";

interface GestureStep {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const GESTURE_STEPS: GestureStep[] = [
  {
    icon: <Hand className="h-8 w-8" />,
    title: "Long-press to select",
    description: "Long-press on text to select blocks for AI editing",
  },
  {
    icon: <MessageSquare className="h-8 w-8" />,
    title: "Bottom bar actions",
    description: "Tap icons below to open sidebar, chat, or outline",
  },
  {
    icon: <Mic className="h-8 w-8" />,
    title: "Voice input",
    description: "Tap the mic icon to dictate with your voice",
  },
];

export function MobileGestureHints() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Delay to let the page settle
      const timer = setTimeout(() => setIsVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  // Auto-advance steps
  useEffect(() => {
    if (!isVisible) return;

    const timer = setTimeout(() => {
      if (currentStep < GESTURE_STEPS.length - 1) {
        setCurrentStep((prev) => prev + 1);
      } else {
        handleDismiss();
      }
    }, 3500);

    return () => clearTimeout(timer);
  }, [isVisible, currentStep]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsVisible(false);
  };

  const handleTap = () => {
    if (currentStep < GESTURE_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  };

  if (!isVisible) return null;

  const step = GESTURE_STEPS[currentStep];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={handleTap}
      >
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:text-white"
          aria-label="Skip hints"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Gesture illustration */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="flex flex-col items-center gap-4 px-8 text-center"
        >
          {/* Animated icon */}
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 text-white"
          >
            {step.icon}
          </motion.div>

          <h3 className="text-lg font-semibold text-white">{step.title}</h3>
          <p className="max-w-[240px] text-sm text-white/70">{step.description}</p>

          {/* Step indicators */}
          <div className="mt-4 flex gap-2">
            {GESTURE_STEPS.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  index <= currentStep ? "bg-white" : "bg-white/20"
                }`}
              />
            ))}
          </div>

          <p className="mt-2 text-xs text-white/40">Tap to continue</p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
