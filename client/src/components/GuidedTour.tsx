import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TourStep {
  target?: string; // CSS selector for the element to highlight (optional for intro/outro)
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to TURATH",
    description: "Let me show you how to turn your archival documents into a searchable, AI-powered research tool. This takes about 60 seconds.",
  },
  {
    target: "[data-tour='new-project']",
    title: "Create a project",
    description: "Each project is a separate archive — like a collection of letters, records, or manuscripts. Start by giving it a name and brief description.",
    position: "bottom",
  },
  {
    target: "[data-tour='upload']",
    title: "Upload your documents",
    description: "Upload scanned images of your documents. TURATH accepts JPG, PNG, TIFF, and PDF. You can upload one at a time or drag a whole batch.",
    position: "right",
  },
  {
    target: "[data-tour='settings']",
    title: "Configure the AI reader",
    description: "Tell the AI what kind of documents these are and what information to extract. You can use the 'Edit with AI' chat to describe changes in plain English.",
    position: "right",
  },
  {
    target: "[data-tour='review']",
    title: "Review transcriptions",
    description: "After processing, review what the AI extracted. Approve accurate transcriptions, edit mistakes, or flag difficult ones for later. Approved documents become searchable.",
    position: "right",
  },
  {
    target: "[data-tour='search']",
    title: "Search your archive",
    description: "Once documents are approved, search across your entire archive using natural language. Find documents by content, date, person, or topic.",
    position: "right",
  },
  {
    target: "[data-tour='ask']",
    title: "Ask questions",
    description: "Ask questions about your archive in plain English. The AI reads across all your documents and cites its sources so you can verify every answer.",
    position: "right",
  },
  {
    target: "[data-tour='entities']",
    title: "Discover connections",
    description: "TURATH automatically identifies people, places, and organizations mentioned in your documents and maps the connections between them.",
    position: "right",
  },
  {
    title: "You're ready!",
    description: "That's the full workflow: Upload → Configure → Process → Review → Explore. Start with a new project, or try the demo project to see everything in action.",
  },
];

const TOUR_STORAGE_KEY = "turath_tour_completed";

export function useTourState() {
  const [showTour, setShowTour] = useState(false);
  const [hasCompletedTour, setHasCompletedTour] = useState(true);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      setHasCompletedTour(false);
    }
  }, []);

  const startTour = useCallback(() => setShowTour(true), []);
  const endTour = useCallback(() => {
    setShowTour(false);
    setHasCompletedTour(true);
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  }, []);

  return { showTour, hasCompletedTour, startTour, endTour };
}

interface GuidedTourProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GuidedTour({ isOpen, onClose }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      return;
    }

    const step = TOUR_STEPS[currentStep];
    if (!step.target) {
      // Center the tooltip for intro/outro steps
      setTooltipStyle({
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      });
      return;
    }

    const el = document.querySelector(step.target);
    if (!el) {
      // If element not found, center it
      setTooltipStyle({
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      });
      return;
    }

    const rect = el.getBoundingClientRect();
    const pos = step.position ?? "bottom";

    let style: React.CSSProperties = { position: "fixed" };

    switch (pos) {
      case "bottom":
        style.top = rect.bottom + 12;
        style.left = rect.left + rect.width / 2;
        style.transform = "translateX(-50%)";
        break;
      case "top":
        style.bottom = window.innerHeight - rect.top + 12;
        style.left = rect.left + rect.width / 2;
        style.transform = "translateX(-50%)";
        break;
      case "right":
        style.top = rect.top + rect.height / 2;
        style.left = rect.right + 12;
        style.transform = "translateY(-50%)";
        break;
      case "left":
        style.top = rect.top + rect.height / 2;
        style.right = window.innerWidth - rect.left + 12;
        style.transform = "translateY(-50%)";
        break;
    }

    setTooltipStyle(style);

    // Scroll element into view
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setCurrentStep(s => s + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) setCurrentStep(s => s - 1);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-[9998]" onClick={onClose} />

      {/* Highlight ring around target element */}
      {step.target && (() => {
        const el = document.querySelector(step.target);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return (
          <div
            className="fixed z-[9999] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-transparent pointer-events-none"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
            }}
          />
        );
      })()}

      {/* Tooltip */}
      <div
        className="z-[10000] w-[360px] bg-card border border-border rounded-xl shadow-2xl p-5"
        style={tooltipStyle}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground font-medium">
              {currentStep + 1} of {TOUR_STEPS.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <h3 className="text-base font-semibold mb-2">{step.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {step.description}
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            disabled={isFirst}
            className="gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </Button>

          <div className="flex gap-1">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === currentStep ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          <Button
            size="sm"
            onClick={handleNext}
            className="gap-1"
          >
            {isLast ? "Get started" : "Next"}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </>
  );
}
