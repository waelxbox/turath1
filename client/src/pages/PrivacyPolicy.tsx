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
              institutional data governance policies. This document describes how TURATH handles materials,
              who owns them, and how to make a data request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Where and How Is My Data Processed?</h2>
            <p className="mb-3">TURATH uses the following managed services to operate the platform:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Uploaded files:</strong> Managed, access-controlled object storage used by TURATH&apos;s application hosting platform. Original files are kept private and served through authenticated, project-authorized application routes.</li>
              <li><strong className="text-foreground">Structured data:</strong> Supabase-managed PostgreSQL stores account, project, transcription, catalog, and metadata records.</li>
              <li><strong className="text-foreground">AI processing:</strong> TURATH sends the material needed to provide a requested feature to Google&apos;s Gemini API, such as transcription, translation, or reviewable catalog suggestions. Google&apos;s handling of that material is governed by the applicable Google API terms and data-use policy.</li>
            </ul>
            <p className="mt-3">
              TURATH is designed not to store uploaded archival files on personal devices or in the public client application. Provider infrastructure, data location, backup, and security controls are governed by the applicable provider terms and configuration.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Who Owns the Data?</h2>
            <p>
              <strong className="text-foreground">You retain ownership of the materials you upload and the rights you hold in resulting work.</strong> TURATH does not claim intellectual-property rights in your documents, transcriptions, translations, or metadata. You are responsible for ensuring that you have authority to upload and process materials through TURATH.
            </p>
            <p className="mt-3">
              TURATH does not intentionally use your archival materials to train a general-purpose TURATH model. Materials are processed to provide the feature you requested, and project configurations are scoped to the relevant project.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Can I Delete My Data?</h2>
            <p>
              You may request deletion of your account or project data at any time. We will confirm the request&apos;s scope and coordinate deletion of operational copies under TURATH&apos;s control, subject to applicable legal obligations and provider backup or retention processes. A request may include:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>All uploaded document images</li>
              <li>All transcriptions, translations, and extracted metadata</li>
              <li>All project configurations, glossaries, and AI prompts</li>
              <li>All entity records and search indices</li>
              <li>Your user account and authentication records</li>
            </ul>
            <p className="mt-3">
              Deletion may be irreversible. We will confirm the request and completion status by email; timing can vary with the request&apos;s scope and the applicable provider processes. To request deletion, email <a href="mailto:adamamin2027@gmail.com" className="text-primary hover:underline">adamamin2027@gmail.com</a>.
            </p>
            <p className="mt-3">
              TURATH provides export tools for supported project outputs, including transcription and catalog formats. Available export formats and scope may vary by project type and feature availability.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Privacy Requests from the EEA and United Kingdom</h2>
            <p>
              If you are in the European Economic Area or the United Kingdom, you may have rights under applicable privacy law. You can contact TURATH to request access, correction, deletion, or an export of supported project data. We will assess and respond to requests in accordance with applicable law and our operational capabilities.
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li><strong className="text-foreground">Access and correction:</strong> You can request a copy of supported project data or ask us to correct personal-account information.</li>
              <li><strong className="text-foreground">Deletion:</strong> You can request deletion as described above.</li>
              <li><strong className="text-foreground">Portability:</strong> Supported project outputs can be exported in the formats available within the platform.</li>
              <li><strong className="text-foreground">International processing:</strong> TURATH relies on service providers that may process data in locations outside your country. Their terms and data-processing commitments govern those transfers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Data Isolation Between Projects</h2>
            <p>
              TURATH enforces project-scoped authorization in the application. Documents, AI configurations,
              transcriptions, catalog records, and research data are intended to be available only to authorized project members. Access controls are designed to prevent one project&apos;s data from being retrieved through another project.
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
              <li><strong className="text-foreground">Technical and usage information:</strong> Basic operational information, such as page visits, feature use, errors, and security-relevant activity, to operate and improve the platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Third-Party Services</h2>
            <p className="mb-3">TURATH uses the following third-party services:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Google Gemini API:</strong> AI-assisted transcription, translation, and reviewable catalog suggestions. Only the material needed for a requested feature is sent for processing; Google&apos;s handling is governed by its applicable terms and data-use policy.</li>
              <li><strong className="text-foreground">Google OAuth:</strong> Secure authentication. We only receive your name and email.</li>
              <li><strong className="text-foreground">Managed hosting and object storage:</strong> Application hosting and private storage for uploaded files.</li>
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
              or has additional compliance requirements, please contact us. We can discuss the platform&apos;s
              current data flows and determine whether its current controls are suitable for your requirements.
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
