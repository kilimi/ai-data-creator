/**
 * /landing — Commercial marketing page for LAI.
 *
 * Standalone product page (similar in spirit to FiftyOne / Roboflow landing
 * pages) that explains what LAI is, who it's for, and what it does. Uses only
 * semantic design tokens — no app chrome (no Navbar / sidebar).
 */
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  Github,
  Layers,
  LineChart,
  Lock,
  MousePointer2,
  Package,
  Rocket,
  Server,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <SiteHeader />
      <Hero />
      <LogoStrip />
      <FeatureGrid />
      <WorkflowSection />
      <ModelsSection />
      <DeploySection />
      <ComparisonSection />
      <PricingSection />
      <CtaSection />
      <SiteFooter />
    </div>
  );
}

/* ----------------------------- Header ------------------------------------ */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <Link to="/landing" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-black">
            L
          </div>
          <span className="text-lg font-bold tracking-tight">LAI</span>
          <Badge variant="secondary" className="ml-1 hidden sm:inline-flex">
            Vision Platform
          </Badge>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#workflow" className="hover:text-foreground transition-colors">Workflow</a>
          <a href="#models" className="hover:text-foreground transition-colors">Models</a>
          <a href="#deploy" className="hover:text-foreground transition-colors">Deploy</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/">Open app</Link>
          </Button>
          <Button asChild size="sm">
            <a href="#cta">
              Get started <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------- Hero -------------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* Background flourish */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      >
        <div className="absolute -top-40 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--foreground)/0.06)_1px,transparent_0)] [background-size:28px_28px]" />
      </div>

      <div className="container mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
        <Badge variant="secondary" className="mb-6 gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Now with SAM 2 + Depth Anything V2
        </Badge>
        <h1 className="mx-auto max-w-4xl text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05]">
          The end-to-end platform
          <br />
          for{" "}
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            computer vision
          </span>
          .
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted-foreground leading-relaxed">
          LAI brings dataset management, AI-assisted annotation, model training,
          evaluation, and deployment into one local-first workspace. Built for
          teams that ship vision models in the real world.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-6">
            <a href="#cta">
              Start free <ArrowRight className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <a href="#workflow">See how it works</a>
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <Stat icon={CheckCircle2}>No credit card required</Stat>
          <Stat icon={Lock}>Self-host or cloud</Stat>
          <Stat icon={Zap}>YOLO • RT-DETR • Mask R-CNN • SAM</Stat>
        </div>

        {/* Product window mock */}
        <div className="mt-16 mx-auto max-w-6xl">
          <div className="rounded-2xl border border-border/80 bg-card shadow-2xl shadow-primary/10 overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
              <span className="h-3 w-3 rounded-full bg-destructive/70" />
              <span className="h-3 w-3 rounded-full bg-amber-400/70" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
              <span className="ml-3 text-xs text-muted-foreground font-mono">lai.local / projects / drone-survey</span>
            </div>
            <div className="grid grid-cols-12 gap-0 h-[420px]">
              <div className="col-span-3 border-r border-border/60 bg-muted/20 p-4 space-y-3 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
                {["Datasets", "Models", "Evaluations", "Exports"].map((t, i) => (
                  <div key={t} className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    i === 0 ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground"
                  )}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {t}
                  </div>
                ))}
              </div>
              <div className="col-span-9 p-5 grid grid-cols-3 gap-3 content-start text-left">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border/70 bg-background/40 p-3 space-y-2">
                    <div className="aspect-[4/3] rounded-md bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
                    <div className="h-2.5 w-2/3 rounded bg-muted" />
                    <div className="h-2 w-1/3 rounded bg-muted/60" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </span>
  );
}

/* --------------------------- Logo strip ---------------------------------- */

function LogoStrip() {
  const items = ["YOLOv8", "YOLOv11", "RT-DETR", "Mask R-CNN", "SAM 2", "Depth Anything V2", "ONNX", "TensorRT"];
  return (
    <section className="border-b border-border/60 bg-muted/20">
      <div className="container mx-auto px-6 py-10">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-muted-foreground mb-6">
          Works with the models your team already uses
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {items.map((m) => (
            <span
              key={m}
              className="text-sm font-semibold text-muted-foreground/80 hover:text-foreground transition-colors"
            >
              {m}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Features ------------------------------------ */

const FEATURES = [
  {
    icon: Database,
    title: "Dataset management",
    desc: "Organize images, collections and groups. Import, deduplicate, tag and search across millions of images.",
  },
  {
    icon: MousePointer2,
    title: "AI-assisted annotation",
    desc: "Draw polygons, bounding boxes and masks with SAM 2. Per-class colors, solo mode, keyboard shortcuts.",
  },
  {
    icon: Sparkles,
    title: "Auto-annotate",
    desc: "Pre-label entire datasets with YOLO or Depth Anything V2 — review, accept, or refine.",
  },
  {
    icon: Brain,
    title: "Train state-of-the-art models",
    desc: "YOLO, RT-DETR, and Mask R-CNN with sane defaults. Multi-dataset configs, augmentations, live monitoring.",
  },
  {
    icon: LineChart,
    title: "Evaluate & compare",
    desc: "mAP, IoU, confusion matrices, per-class breakdowns and side-by-side run comparisons.",
  },
  {
    icon: Package,
    title: "Export anywhere",
    desc: "ONNX, TensorRT, TorchScript, CoreML. Test inference in-app before shipping to production.",
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="border-b border-border/60">
      <div className="container mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl mb-14">
          <Badge variant="secondary" className="mb-3">Platform</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Everything your vision team needs, in one place.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Stop stitching together five tools. LAI owns the full lifecycle —
            from raw pixels to production model.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-border/70 bg-card p-6 hover:border-primary/50 hover:bg-accent/30 transition-colors"
            >
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-lg">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Workflow ------------------------------------ */

const STEPS = [
  {
    icon: Database,
    n: "01",
    title: "Ingest",
    desc: "Upload images in chunks of up to 1,000 at a time. Group into collections, tag and split.",
  },
  {
    icon: MousePointer2,
    n: "02",
    title: "Annotate",
    desc: "Use SAM-assisted polygons, classification, or bulk auto-annotation with your favorite detector.",
  },
  {
    icon: Brain,
    n: "03",
    title: "Train",
    desc: "Pick a model size, set epochs, hit Start. Monitor loss curves and sample predictions live.",
  },
  {
    icon: LineChart,
    n: "04",
    title: "Evaluate",
    desc: "Inspect mAP, confusion matrices and failure cases. Compare runs side-by-side.",
  },
  {
    icon: Package,
    n: "05",
    title: "Export",
    desc: "Convert to ONNX or TensorRT. Validate with the built-in inference tester before shipping.",
  },
];

function WorkflowSection() {
  return (
    <section id="workflow" className="border-b border-border/60 bg-muted/20">
      <div className="container mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl mb-14">
          <Badge variant="secondary" className="mb-3">Workflow</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            From raw images to deployed model in five steps.
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-border/70 bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground">{s.n}</span>
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <p className="font-semibold">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Models -------------------------------------- */

function ModelsSection() {
  const models = [
    { name: "YOLO v8 / v11", task: "Detection · Segmentation", sizes: "n · s · m · l · x" },
    { name: "RT-DETR", task: "Real-time detection", sizes: "l · x" },
    { name: "Mask R-CNN", task: "Instance segmentation", sizes: "ResNet-50 · 101" },
    { name: "SAM 2", task: "Promptable segmentation", sizes: "tiny · small · base · large" },
    { name: "Depth Anything V2", task: "Monocular depth", sizes: "small · base · large" },
  ];
  return (
    <section id="models" className="border-b border-border/60">
      <div className="container mx-auto grid lg:grid-cols-2 gap-14 px-6 py-20 md:py-28 items-center">
        <div>
          <Badge variant="secondary" className="mb-3">Models</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            A model zoo wired in from day one.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
            LAI ships with the architectures vision teams actually deploy.
            Choose a size, point it at a dataset, and let the platform handle
            data loading, augmentations, checkpointing, and metrics.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm">
            {[
              "Pre-downloaded weights — no scavenger hunts",
              "Multi-dataset training out of the box",
              "Reruns enforce matching annotation types",
              "Per-class color sync across the workspace",
            ].map((b) => (
              <li key={b} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span className="text-muted-foreground">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
          <div className="border-b border-border/60 px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
            Available architectures
          </div>
          <ul className="divide-y divide-border/60">
            {models.map((m) => (
              <li key={m.name} className="grid grid-cols-12 items-center gap-3 px-5 py-4">
                <div className="col-span-5">
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.task}</p>
                </div>
                <div className="col-span-7 text-right text-xs font-mono text-muted-foreground">
                  {m.sizes}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Deploy -------------------------------------- */

function DeploySection() {
  const cards = [
    {
      icon: Server,
      title: "Self-hosted",
      desc: "Run LAI entirely on your hardware. Your data never leaves the network.",
    },
    {
      icon: Cpu,
      title: "GPU-accelerated",
      desc: "CUDA-ready training and inference. SAM service runs in its own container.",
    },
    {
      icon: Workflow,
      title: "API-first",
      desc: "Every action in the UI is a REST endpoint. Automate pipelines from CI.",
    },
    {
      icon: Boxes,
      title: "Docker-native",
      desc: "One docker compose up brings the whole platform online in minutes.",
    },
  ];
  return (
    <section id="deploy" className="border-b border-border/60 bg-muted/20">
      <div className="container mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl mb-14">
          <Badge variant="secondary" className="mb-3">Deploy</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Your data. Your hardware. Your rules.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            LAI is local-first by design. Deploy on a workstation, a lab GPU
            box, or a private Kubernetes cluster — same experience either way.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.title} className="rounded-xl border border-border/70 bg-card p-6">
              <c.icon className="h-6 w-6 text-primary mb-4" />
              <p className="font-semibold">{c.title}</p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Comparison ---------------------------------- */

function ComparisonSection() {
  const rows = [
    ["End-to-end (label → train → deploy)", true, "partial", "partial"],
    ["Self-hosted by default", true, false, "partial"],
    ["SAM 2 + Depth Anything V2 built-in", true, false, false],
    ["Native multi-dataset training", true, false, "partial"],
    ["No per-image pricing", true, false, false],
    ["Direct ONNX / TensorRT export", true, "partial", true],
  ];
  const cols = ["LAI", "Roboflow", "FiftyOne"];
  return (
    <section className="border-b border-border/60">
      <div className="container mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl mb-10">
          <Badge variant="secondary" className="mb-3">Comparison</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            How LAI stacks up.
          </h2>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-5 py-3">Capability</th>
                {cols.map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "text-center font-semibold px-5 py-3 w-[140px]",
                      i === 0 && "text-primary"
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="px-5 py-4">{row[0] as string}</td>
                  {(row.slice(1) as Array<boolean | string>).map((v, ci) => (
                    <td key={ci} className="text-center px-5 py-4">
                      <Mark value={v} highlight={ci === 0} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Mark({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  if (value === true)
    return (
      <CheckCircle2
        className={cn("inline h-5 w-5", highlight ? "text-primary" : "text-emerald-500")}
      />
    );
  if (value === "partial")
    return <span className="text-xs text-muted-foreground">Partial</span>;
  return <span className="text-muted-foreground/40">—</span>;
}

/* --------------------------- Pricing ------------------------------------- */

function PricingSection() {
  const tiers = [
    {
      name: "Community",
      price: "Free",
      tag: "Self-hosted",
      desc: "Everything you need to label, train, and deploy on your own machine.",
      features: [
        "Unlimited datasets & images",
        "All built-in models",
        "Local SAM service",
        "Community support",
      ],
      cta: "Download",
      featured: false,
    },
    {
      name: "Team",
      price: "$49",
      tag: "per user / month",
      desc: "Collaboration, role-based access, and priority support for production teams.",
      features: [
        "Everything in Community",
        "Multi-user workspaces",
        "Roles & permissions",
        "Priority email support",
      ],
      cta: "Start free trial",
      featured: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      tag: "Talk to us",
      desc: "Dedicated deployment, SSO/SAML, audit logs, and white-glove onboarding.",
      features: [
        "On-prem or VPC deploy",
        "SSO / SAML / SCIM",
        "Audit logs & compliance",
        "Dedicated CSM",
      ],
      cta: "Contact sales",
      featured: false,
    },
  ];
  return (
    <section id="pricing" className="border-b border-border/60 bg-muted/20">
      <div className="container mx-auto px-6 py-20 md:py-28">
        <div className="max-w-2xl mb-14 text-center mx-auto">
          <Badge variant="secondary" className="mb-3">Pricing</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Simple, transparent pricing.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Start free. Upgrade when your team grows.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative rounded-2xl border bg-card p-7 flex flex-col",
                t.featured
                  ? "border-primary shadow-xl shadow-primary/10 scale-[1.02]"
                  : "border-border/70"
              )}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}
              <p className="text-sm font-semibold text-muted-foreground">{t.name}</p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight">{t.price}</span>
                <span className="text-sm text-muted-foreground">{t.tag}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{t.desc}</p>
              <ul className="mt-5 space-y-2 text-sm flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6"
                variant={t.featured ? "default" : "outline"}
              >
                {t.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- CTA ---------------------------------------- */

function CtaSection() {
  return (
    <section id="cta" className="border-b border-border/60">
      <div className="container mx-auto px-6 py-24 md:py-32 text-center">
        <Rocket className="h-10 w-10 text-primary mx-auto mb-5" />
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
          Ready to ship better vision models, faster?
        </h2>
        <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
          Spin up LAI on your own machine in under five minutes.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-6">
            <Link to="/">
              Open the app <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <a href="#" className="inline-flex items-center gap-2">
              <Github className="h-4 w-4" /> View on GitHub
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Footer -------------------------------------- */

function SiteFooter() {
  return (
    <footer className="bg-background">
      <div className="container mx-auto px-6 py-12 grid gap-10 md:grid-cols-4 text-sm">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-black">
              L
            </div>
            <span className="text-lg font-bold">LAI</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            The end-to-end platform for computer vision teams.
          </p>
        </div>
        <FooterCol title="Product" links={["Features", "Workflow", "Models", "Pricing"]} />
        <FooterCol title="Resources" links={["Documentation", "Help center", "Changelog", "GitHub"]} />
        <FooterCol title="Company" links={["About", "Blog", "Contact", "Privacy"]} />
      </div>
      <div className="border-t border-border/60">
        <div className="container mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} LAI. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Built for vision teams that ship.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <p className="font-semibold mb-3">{title}</p>
      <ul className="space-y-2 text-muted-foreground">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="hover:text-foreground transition-colors">{l}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
