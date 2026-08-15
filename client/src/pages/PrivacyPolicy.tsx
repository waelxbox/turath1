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
        <h1 className="text-3xl font-serif font-semibold mb-2">Privacy & Data Policy</h1>
        <p className="text-sm text-muted-foreground mb-12">Last updated: August 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-[15px] leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Overview</h2>
            <p>
              TURATH is an archival transcription platform designed for researchers, librarians, and archivists.
              We understand that archival materials are often sensitive, culturally significant, and subject to
              institutional data governance policies. This document explains exactly where your data lives,
              who owns it, and how to remove it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Where Is My Data Stored?</h2>
            <p className="mb-3">TURATH stores data in the following locations:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Document images and files:</strong> Amazon Web Services (AWS) S3 object storage, US region.</li>
              <li><strong className="text-foreground">Database (transcriptions, metadata, user accounts):</strong> Supabase-managed PostgreSQL, hosted on AWS infrastructure.</li>
              <li><strong className="text-foreground">AI processing:</strong> Document images are sent to Google's Gemini API for transcription. Google does not retain input data after processing per their API terms of service.</li>
            </ul>
            <p className="mt-3">
              All data is encrypted in transit (TLS 1.2+) and at rest (AES-256). No data is stored on local servers or personal devices.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Who Owns the Data?</h2>
            <p>
              <strong className="text-foreground">You retain full ownership of all materials you upload and all outputs generated from them.</strong> TURATH does not claim any intellectual property rights over your documents, transcriptions, translations, or metadata. Your data is yours.
            </p>
            <p className="mt-3">
              We do not use your documents to train general-purpose AI models. Your materials are processed solely to provide the transcription service you requested, and AI configurations are scoped to your individual project.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Can I Delete My Data?</h2>
            <p>
              Yes. You can request complete deletion of your account and all associated data at any time.
              Upon request, we permanently delete:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>All uploaded document images</li>
              <li>All transcriptions, translations, and extracted metadata</li>
              <li>All project configurations, glossaries, and AI prompts</li>
              <li>All entity records and search indices</li>
              <li>Your user account and authentication records</li>
            </ul>
            <p className="mt-3">
              Deletion is irreversible and typically completed within 7 business days. To request deletion,
              email <a href="mailto:adamamin2027@gmail.com" className="text-primary hover:underline">adamamin2027@gmail.com</a>.
            </p>
            <p className="mt-3">
              You can also export all your data (transcriptions, metadata, and project configurations) at any
              time via the platform's built-in export feature (CSV, JSON, or TEI-XML).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">GDPR Compliance</h2>
            <p>
              TURATH is committed to compliance with the EU General Data Protection Regulation (GDPR).
              For users and institutions in the European Economic Area:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li><strong className="text-foreground">Lawful basis:</strong> We process your data based on your consent (account creation) and contractual necessity (providing the transcription service).</li>
              <li><strong className="text-foreground">Right of access:</strong> You can view and export all data we hold about you at any time through the platform.</li>
              <li><strong className="text-foreground">Right to rectification:</strong> You can edit any transcription or metadata directly in the review interface.</li>
              <li><strong className="text-foreground">Right to erasure:</strong> You can request complete deletion of your data (see above).</li>
              <li><strong className="text-foreground">Right to data portability:</strong> All data is exportable in standard formats (JSON, CSV, TEI-XML).</li>
              <li><strong className="text-foreground">Data transfers:</strong> Data is stored in the United States. Transfers from the EU are governed by Standard Contractual Clauses (SCCs) as implemented by our infrastructure providers (AWS, Supabase, Google Cloud).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Data Isolation Between Projects</h2>
            <p>
              Each TURATH project is completely isolated at the database level. Documents, AI configurations,
              transcriptions, and research data are never shared between projects or with other users.
              Institutional collections remain accessible only to authorized project members.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Information We Collect</h2>
            <p className="mb-3">When you use TURATH, we collect:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Account information:</strong> Your name and email address, provided via Google OAuth sign-in.</li>
              <li><strong className="text-foreground">Document images:</strong> The archival document images you upload for transcription.</li>
              <li><strong className="text-foreground">Transcription data:</strong> AI-generated transcriptions and any corrections you make during review.</li>
              <li><strong className="text-foreground">Project configuration:</strong> Custom AI settings, glossaries, and extraction schemas.</li>
              <li><strong className="text-foreground">Usage data:</strong> Basic analytics (page views, feature usage) to improve the platform. No tracking cookies or advertising identifiers are used.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Third-Party Services</h2>
            <p className="mb-3">TURATH uses the following third-party services:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Google Cloud (Gemini AI):</strong> Document transcription and translation. Images are sent for processing and not retained by Google after the API call completes.</li>
              <li><strong className="text-foreground">Google OAuth:</strong> Secure authentication. We only receive your name and email.</li>
              <li><strong className="text-foreground">AWS S3:</strong> File storage for uploaded document images.</li>
              <li><strong className="text-foreground">Supabase (PostgreSQL):</strong> Database hosting for structured data.</li>
            </ul>
            <p className="mt-3">
              We do not sell, share, or provide your data to advertisers, data brokers, or any third parties
              beyond what is necessary to operate the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">For Institutional Partners</h2>
            <p>
              If your institution requires a Data Processing Agreement (DPA), specific security documentation,
              or has additional compliance requirements, please contact us. We are happy to work with your
              IT and legal teams to ensure TURATH meets your institutional data governance standards.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>
              For privacy-related questions, data deletion requests, or institutional inquiries, please contact:{" "}
              <a href="mailto:adamamin2027@gmail.com" className="text-primary hover:underline">
                adamamin2027@gmail.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
