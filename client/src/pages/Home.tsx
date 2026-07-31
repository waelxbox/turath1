import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { ArrowRight, Layers, Wand2, CheckCircle2, FileText, Download, Users } from "lucide-react";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/dashboard");
    }
  }, [loading, isAuthenticated, navigate]);

  if (!loading && isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">ت</span>
            </div>
            <span className="font-serif font-semibold text-lg tracking-tight">TURATH</span>
          </div>
          <div className="flex items-center gap-3">
            <a href={getLoginUrl()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Sign in
            </a>
            <Button size="sm" asChild>
              <a href={getLoginUrl()}>Get started</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 relative">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="container relative">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AI-powered archival transcription
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-serif font-semibold leading-[1.1] tracking-tight mb-6">
              Your archive.{" "}
              <span className="text-primary">Your AI.</span>
              <br />Your workflow.
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Show the AI a few examples of your documents, and it learns to read the rest.
              Search, ask questions, and discover connections across your entire archive.
              No infrastructure. No code.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Button size="lg" className="gap-2 text-base px-8" asChild>
                <a href={getLoginUrl()}>
                  Start transcribing <ArrowRight className="w-4 h-4" />
                </a>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base px-8 bg-transparent" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
          </div>

          {/* Hero visual */}
          <div className="mt-20 max-w-5xl mx-auto">
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-black/40">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/50">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
                <div className="flex-1 mx-4 h-6 rounded bg-background/60 flex items-center px-3">
                  <span className="text-xs text-muted-foreground">turath.manus.space/projects/brovarski</span>
                </div>
              </div>
              {/* Fake UI */}
              <div className="grid grid-cols-12 min-h-[320px]">
                {/* Sidebar */}
                <div className="col-span-2 border-r border-border bg-sidebar p-3 space-y-1">
                  {["Overview", "Upload", "Review", "Export", "Settings"].map((item, i) => (
                    <div key={item} className={`px-2 py-1.5 rounded text-xs ${i === 2 ? "bg-primary/20 text-primary" : "text-sidebar-foreground/60"}`}>
                      {item}
                    </div>
                  ))}
                </div>
                {/* Main content */}
                <div className="col-span-10 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <div className="h-5 w-48 bg-foreground/10 rounded mb-2" />
                      <div className="h-3 w-32 bg-foreground/5 rounded" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-8 w-24 bg-primary/20 rounded border border-primary/30" />
                      <div className="h-8 w-20 bg-foreground/5 rounded border border-border" />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mb-6">
                    {[["247", "Total"], ["189", "Reviewed"], ["41", "Pending"], ["17", "Flagged"]].map(([n, l]) => (
                      <div key={l} className="bg-background rounded-lg border border-border p-3">
                        <div className="text-xl font-semibold text-foreground">{n}</div>
                        <div className="text-xs text-muted-foreground">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {[
                      { name: "BRV_0047.jpg", status: "reviewed", color: "text-green-700 dark:text-green-400" },
                      { name: "BRV_0048.jpg", status: "needs review", color: "text-yellow-700 dark:text-yellow-400" },
                      { name: "BRV_0049.jpg", status: "processing", color: "text-amber-700 dark:text-amber-400" },
                    ].map(row => (
                      <div key={row.name} className="flex items-center justify-between py-2 px-3 rounded bg-background/50 border border-border/50 text-xs">
                        <span className="text-foreground/70">{row.name}</span>
                        <span className={row.color}>{row.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 border-t border-border/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-4">From examples to a working reader in minutes</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Show the AI how you want your documents read, and it builds itself. No programming required.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                icon: Layers,
                step: "01",
                title: "Upload 3–5 samples",
                desc: "Upload a few document images with your ideal transcriptions. The AI learns your style from these examples.",
              },
              {
                icon: Wand2,
                step: "02",
                title: "AI builds your config",
                desc: "The AI studies your examples and builds a custom reader — it figures out the language, structure, and terminology automatically.",
              },
              {
                icon: CheckCircle2,
                step: "03",
                title: "Validate & refine",
                desc: "The AI tests itself against one of your examples. If something's off, just tell it what to fix in plain language.",
              },
            ].map(({ icon: Icon, step, title, desc }) => (
              <div key={step} className="relative">
                <div className="text-6xl font-serif font-bold text-border/40 absolute -top-4 -left-2 select-none">{step}</div>
                <div className="relative bg-card border border-border rounded-xl p-6 pt-8">
                  <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2 font-sans">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-4">Everything a digital archive needs</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { icon: FileText, title: "Smart review interface", desc: "Review AI transcriptions side-by-side with the original document. Edit fields, approve, or flag for later." },
              { icon: Wand2, title: "Flexible reading modes", desc: "Direct extraction for simple documents. Two-step reading for complex handwriting or multi-language materials." },
              { icon: Users, title: "Private by design", desc: "Each project is completely isolated. Your documents, AI settings, and data are never shared between projects." },
              { icon: Layers, title: "Learns your terminology", desc: "The AI picks up specialized names, places, and terms from your examples and uses them consistently." },
              { icon: Download, title: "Export anywhere", desc: "Download your transcriptions as CSV or JSON for use in databases, publications, or other tools." },
              { icon: CheckCircle2, title: "Track your progress", desc: "See which documents are done, which need review, and how far along your project is at a glance." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-colors">
                <Icon className="w-5 h-5 text-primary mb-3" />
                <h3 className="font-semibold mb-1.5 font-sans text-sm">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-serif font-semibold mb-4">Ready to digitize your archive?</h2>
            <p className="text-muted-foreground mb-8">
              Join researchers, digital librarians, and archivists who are using TURATH to bring their collections online.
            </p>
            <Button size="lg" className="gap-2 text-base px-10" asChild>
              <a href={getLoginUrl()}>
                Create your first project <ArrowRight className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
              <span className="text-primary font-bold text-[10px]">ت</span>
            </div>
            <span>TURATH — Archival Transcription Platform</span>
          </div>
          <span>تراث</span>
        </div>
      </footer>
    </div>
  );
}
