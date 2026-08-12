import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function PrivacyPolicy() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center h-16 px-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to TURATH
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-serif font-semibold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: August 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-[15px] leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Overview</h2>
            <p>
              TURATH is an archival transcription platform designed for researchers, librarians, and archivists.
              We take the privacy of your documents and data seriously. This policy explains what information
              we collect, how we use it, and your rights regarding your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Information We Collect</h2>
            <p className="mb-3">When you use TURATH, we collect:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Account information:</strong> Your name and email address, provided via Google OAuth sign-in.</li>
              <li><strong className="text-foreground">Document images:</strong> The archival document images you upload for transcription processing.</li>
              <li><strong className="text-foreground">Transcription data:</strong> The AI-generated transcriptions and any edits you make during the review process.</li>
              <li><strong className="text-foreground">Project configuration:</strong> Custom AI settings, glossaries, and system prompts you create for your collections.</li>
              <li><strong className="text-foreground">Usage data:</strong> Basic analytics about how you interact with the platform (page views, feature usage).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To provide the transcription, translation, and indexing services you request.</li>
              <li>To improve the accuracy of AI models for your specific collection (your data trains only your project's reader — never shared across projects).</li>
              <li>To maintain and improve the platform's functionality and performance.</li>
              <li>To communicate with you about your account or service updates.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Data Isolation</h2>
            <p>
              Each TURATH project is completely isolated. Your documents, AI configurations, transcriptions,
              and research data are never shared between projects or with other users. Your archival materials
              remain yours.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Third-Party Services</h2>
            <p className="mb-3">TURATH uses the following third-party services to operate:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Google Cloud (Gemini AI):</strong> For document transcription and translation processing.</li>
              <li><strong className="text-foreground">Google OAuth:</strong> For secure authentication.</li>
              <li><strong className="text-foreground">Supabase:</strong> For database hosting and file storage.</li>
            </ul>
            <p className="mt-3">
              These services process your data only as necessary to provide TURATH's functionality.
              We do not sell or share your data with advertisers or data brokers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Data Retention</h2>
            <p>
              Your data is retained for as long as your account is active. You may request deletion of
              your account and all associated data at any time by contacting us. Upon deletion, all
              document images, transcriptions, and project data are permanently removed from our systems.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access all data we hold about you.</li>
              <li>Export your transcriptions and project data at any time (CSV, JSON).</li>
              <li>Request correction of inaccurate information.</li>
              <li>Request deletion of your account and all associated data.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>
              For privacy-related questions or requests, please contact Adam Amin at{" "}
              <a href="mailto:adamamin2027@gmail.com" className="text-primary hover:underline">
                adamamin2027@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
