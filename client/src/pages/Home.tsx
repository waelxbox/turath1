import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { ArrowRight, Search, BookOpen, Network, Eye, Upload, CheckCircle2 } from "lucide-react";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();


  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-6">
          <a href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">ت</span>
            </div>
            <span className="font-serif font-semibold text-lg tracking-tight">TURATH</span>
          </a>
          <div className="flex items-center gap-4">
            <a href="#about" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden md:block">
              About
            </a>
            <Button size="sm" className="rounded-full px-6" asChild>
              <a href={isAuthenticated ? "/dashboard" : getLoginUrl()}>{isAuthenticated ? "Dashboard" : "Get started"}</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-32 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-primary/3 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-[11px] font-semibold text-primary uppercase tracking-[0.15em] mb-10">
              Archival Intelligence
            </p>
            <h1 className="text-5xl sm:text-6xl lg:text-[4.5rem] font-serif font-semibold leading-[1.08] tracking-tight mb-6">
              Unlock the stories your{" "}
              <span className="text-primary">archive</span> holds
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              TURATH helps researchers transcribe, search, and converse with historical
              document collections — with systems that learn from your scholarly expertise
              and respect the heritage of the artifacts.
            </p>
            <Button size="lg" className="gap-2 text-base px-8 rounded-full shadow-[0_0_20px_rgba(196,136,58,0.15)] hover:shadow-[0_0_30px_rgba(196,136,58,0.25)] transition-shadow" asChild>
              <a href={isAuthenticated ? "/dashboard" : getLoginUrl()}>
                {isAuthenticated ? "Go to dashboard" : "Start a project"} <ArrowRight className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Visual Metaphor — Manuscript → Structured Data */}
      <section className="pb-36 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="relative w-full rounded-2xl border border-border bg-card overflow-hidden flex flex-col md:flex-row shadow-2xl shadow-black/8 dark:shadow-black/40 ring-1 ring-black/5 dark:ring-white/5">
            {/* Left: Manuscript Image */}
            <div className="w-full md:w-1/2 h-72 md:h-[460px] relative border-b md:border-b-0 md:border-r border-border">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-80 dark:opacity-60"
                style={{ backgroundImage: "url('/manus-storage/manuscript-hero_30d26bf3.png')" }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-card dark:to-card" />
              <div className="absolute top-4 left-4 bg-background/80 dark:bg-background/60 backdrop-blur-sm px-3 py-1 rounded text-[10px] font-bold text-primary tracking-widest uppercase border border-border/50">
                Original Artifact
              </div>
            </div>
            {/* Right: Structured Output */}
            <div className="w-full md:w-1/2 h-72 md:h-[460px] bg-card p-8 md:p-12 flex flex-col justify-center relative">
              <div className="absolute top-4 right-4 bg-background/80 dark:bg-background/60 backdrop-blur-sm px-3 py-1 rounded text-[10px] font-bold text-primary tracking-widest uppercase border border-border/50">
                Structured Record
              </div>
              <div className="w-full max-w-sm bg-background/50 dark:bg-background/30 backdrop-blur-sm p-6 rounded-lg border border-border/50 flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">Date</span>
                  <span className="font-mono text-sm text-foreground">14 March 1923</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">From</span>
                  <span className="font-mono text-sm text-foreground">Georges Behna</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">To</span>
                  <span className="font-mono text-sm text-foreground">Yokohama Trading Co.</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">Subject</span>
                  <span className="font-mono text-sm text-primary">Shipment of textiles delayed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-32 border-t border-border/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-4">A thoughtful approach to preservation</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Stewardship of historical collections requires care. Our process ensures your expertise remains central.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl mx-auto">
            {[
              {
                icon: Upload,
                title: "1. Show it your archive",
                desc: "Upload a representative sample of documents alongside your existing, meticulous transcriptions to establish a baseline.",
              },
              {
                icon: BookOpen,
                title: "2. It learns your collection",
                desc: "TURATH carefully builds a custom understanding tuned specifically to the unique handwriting, dialects, and terminology of your era.",
              },
              {
                icon: CheckCircle2,
                title: "3. Review and discover",
                desc: "You retain full editorial control, reviewing all output. Once validated, seamlessly search and draw connections across the entire corpus.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full border-2 border-border bg-card flex items-center justify-center mb-8 text-primary group-hover:border-primary group-hover:shadow-lg group-hover:shadow-primary/10 transition-all duration-300">
                  <Icon className="w-8 h-8" strokeWidth={1.5} />
                </div>
                <h3 className="font-semibold text-lg mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What becomes possible — Editorial layout */}
      <section id="about" className="py-32 border-t border-border/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-20">
            <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-4">What becomes possible</h2>
            <p className="text-muted-foreground max-w-2xl">
              Transform static archives into dynamic bodies of knowledge, revealing connections that would take a lifetime to uncover manually.
            </p>
          </div>
          <div className="flex flex-col gap-16 md:gap-20">
            {[
              {
                icon: Search,
                label: "Natural Query",
                title: "Converse with history",
                desc: "Ask complex questions like \"Who did the Behna family trade with during the embargo?\" and receive cited answers drawn directly from your primary sources.",
              },
              {
                icon: BookOpen,
                title: "Instant Corpus Search",
                desc: "Search thousands of delicate pages instantly without risking physical handling of the artifacts.",
              },
              {
                icon: Network,
                title: "Uncover Hidden Networks",
                desc: "Automatically identify named entities — people, locations, trade goods — and visualize their relationships across decades of documents.",
              },
              {
                icon: Eye,
                label: "Fidelity",
                title: "Side-by-side verification",
                desc: "The review interface keeps the original artifact intimately connected to its transcription, ensuring scholarly rigor.",
              },
            ].map(({ icon: Icon, label, title, desc }) => (
              <div key={title} className="flex flex-col md:flex-row gap-6 md:gap-12 items-start">
                <div className="text-primary mt-1 flex-shrink-0">
                  <Icon className="w-8 h-8" />
                </div>
                <div className="max-w-2xl">
                  {label && (
                    <span className="text-xs font-semibold text-primary uppercase tracking-widest mb-2 block">{label}</span>
                  )}
                  <h3 className="text-xl md:text-2xl font-semibold mb-3">{title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-[17px]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 border-t border-border/50 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-6">Ready to unlock your archive?</h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
            Begin the careful process of bringing your historical collection into the light — preserving them for future generations of scholars.
          </p>
          <Button size="lg" className="gap-2 text-base px-10 rounded-full" asChild>
            <a href={isAuthenticated ? "/dashboard" : getLoginUrl()}>
              {isAuthenticated ? "Go to dashboard" : "Start a project"} <ArrowRight className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
              <span className="text-primary font-bold text-[10px]">ت</span>
            </div>
            <span className="text-xs text-muted-foreground">TURATH — Archival Transcription Platform</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Privacy Policy
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
