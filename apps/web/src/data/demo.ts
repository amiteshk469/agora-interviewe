import type { LucideIcon } from "lucide-react";
import { BarChart3, BriefcaseBusiness, MessagesSquare, Scale, Sparkles } from "lucide-react";

export type Panelist = {
  id: string;
  name: string;
  role: string;
  initials: string;
  avatarImage: string;
  avatarId: string;
  avatarVendor: "liveavatar" | "akool" | "anam" | "generic";
  mood: string;
  behavior: string;
  voice: string;
  prompt: string;
  defaultPrompt?: string;
  promptSlug?: string;
  allowedTools?: string[];
  expertise?: string[];
  icon?: LucideIcon;
};

export const defaultPanelists: Panelist[] = [
  {
    id: "head-of-product",
    name: "Leah Kim",
    role: "Head of Product",
    initials: "LK",
    avatarImage: "/avatars/leah-kim.png",
    avatarId: "leah-kim",
    avatarVendor: "liveavatar",
    mood: "Direct",
    behavior: "Tests prioritization",
    voice: "indian-calm",
    prompt: "Test product judgment, segmentation, tradeoffs, and strategic clarity. Ask one focused follow-up at a time.",
    icon: BriefcaseBusiness,
  },
  {
    id: "engineering-director",
    name: "Marcus Chen",
    role: "Engineering Director",
    initials: "MC",
    avatarImage: "/avatars/marcus-chen.png",
    avatarId: "marcus-chen",
    avatarVendor: "liveavatar",
    mood: "Focused",
    behavior: "Challenges feasibility",
    voice: "indian-advisor",
    prompt: "Test technical judgment, feasibility, sequencing, tradeoffs, and cross-functional execution. Ask precise follow-ups.",
    icon: BriefcaseBusiness,
  },
  {
    id: "design-lead",
    name: "Priya Nair",
    role: "Design Lead",
    initials: "PN",
    avatarImage: "/avatars/priya-nair.png",
    avatarId: "priya-nair",
    avatarVendor: "liveavatar",
    mood: "Warm",
    behavior: "Probes user evidence",
    voice: "indian-bright",
    prompt: "Test user insight, interaction judgment, inclusive design, and clarity of product rationale.",
    icon: Sparkles,
  },
  {
    id: "data-scientist",
    name: "Jordan Blake",
    role: "Data Scientist",
    initials: "JB",
    avatarImage: "/avatars/jordan-blake.png",
    avatarId: "jordan-blake",
    avatarVendor: "liveavatar",
    mood: "Calm",
    behavior: "Challenges metrics",
    voice: "indian-anchor",
    prompt: "Test metric selection, experiment design, quantitative reasoning, and decision quality. Use calculations when useful.",
    icon: BarChart3,
  },
  {
    id: "business-strategy",
    name: "Ravi Patel",
    role: "VP, Business Strategy",
    initials: "RP",
    avatarImage: "/avatars/ravi-patel.png",
    avatarId: "ravi-patel",
    avatarVendor: "liveavatar",
    mood: "Demanding",
    behavior: "Finds contradictions",
    voice: "indian-deep",
    prompt: "Look for contradictions, shallow claims, commercial tradeoffs, and missing evidence. Re-enter when a prior answer deserves a sharper test.",
    icon: Scale,
  },
];

export const promptTemplates = [
  { id: "product-sense", name: "Product sense core", role: "Strategy", builtIn: true, updated: "RoundCraft default", summary: "Segmentation, needs, prioritization, solution quality, and tradeoffs." },
  { id: "analytics", name: "Metrics and experiments", role: "Analytics", builtIn: true, updated: "RoundCraft default", summary: "North stars, guardrails, experiment design, and quantitative follow-ups." },
  { id: "behavioral", name: "Leadership and influence", role: "Behavioral", builtIn: true, updated: "RoundCraft default", summary: "Conflict, influence, execution, ownership, and reflective learning." },
  { id: "bar-raiser", name: "High-bar challenge", role: "Bar raiser", builtIn: true, updated: "RoundCraft default", summary: "Contradictions, vague evidence, hard prioritization, and adaptive depth." },
];

export const transcript = [
  { id: "turn-01", speaker: "Leah", kind: "panel" as const, time: "03:12", text: "You chose first-time managers as the initial segment. What makes their pain both urgent and underserved?" },
  { id: "turn-02", speaker: "You", kind: "candidate" as const, time: "03:29", text: "They face a high-stakes transition with little structured support. Existing tools track work but do not help them build the habits needed to lead a team." },
  { id: "turn-03", speaker: "Jordan", kind: "panel" as const, time: "04:04", text: "How would you know in the first four weeks that those habits are changing? Choose one leading signal and one guardrail." },
  { id: "turn-04", speaker: "You", kind: "candidate" as const, time: "04:21", text: "I would track completion of recurring one-to-one preparation and use a short direct-report pulse as a guardrail against performative activity." },
  { id: "turn-05", speaker: "Leah", kind: "panel" as const, time: "05:08", text: "You called pulse feedback a guardrail. Why is it not the outcome itself, and what decision would a decline trigger?" },
];

export const toolActivity = [
  { id: "tool-1", name: "JD knowledge search", detail: "Found 4 relevant passages", status: "done", time: "04:02" },
  { id: "tool-2", name: "Metric calculator", detail: "Activation to retention model", status: "done", time: "07:18" },
  { id: "tool-3", name: "Evidence bookmark", detail: "Linked turn-04 to metric quality", status: "done", time: "07:33" },
];

export const competencies = [
  { name: "Product judgment", score: 82, level: "Strong", evidence: ["turn-02", "turn-08"], note: "Clear segmentation and prioritization. Make the unmet-need evidence more explicit." },
  { name: "Analytical thinking", score: 74, level: "Solid", evidence: ["turn-04", "turn-11"], note: "Good leading signal. Define thresholds and the decision rule earlier." },
  { name: "Communication", score: 86, level: "Strong", evidence: ["turn-02", "turn-04"], note: "Structured, concise answers that remained easy to follow under interruption." },
  { name: "Execution", score: null, level: "Insufficient evidence", evidence: [], note: "The panel did not collect enough delivery evidence to score this fairly." },
];

export const interviewHistory = [
  { id: "rc-1042", title: "Senior PM, Growth", company: "Northstar", date: "Aug 30", score: 81, duration: "34 min", status: "Complete" },
  { id: "rc-1038", title: "Product sense practice", company: "General", date: "Aug 27", score: 74, duration: "29 min", status: "Complete" },
  { id: "rc-1029", title: "Analytics deep dive", company: "Fintech", date: "Aug 22", score: 69, duration: "22 min", status: "Complete" },
];

export const featureSignals = [
  { icon: MessagesSquare, title: "A panel that listens", text: "Two to five interviewers share context and decide who should challenge you next." },
  { icon: Sparkles, title: "Prepared for your target role", text: "Upload a job description or start with proven defaults. Every recommendation stays editable." },
  { icon: Scale, title: "Evidence before opinion", text: "Every score links back to exact transcript turns. Missing proof stays unscored." },
];
