"""Role packs: the hiring tracks RoundCraft can interview for.

A pack is the whole shape of an interview for one job family — who sits on the
panel, what they are listening for, which tools they may reach for, and whether
the candidate needs an editor in front of them. Everything a pack produces is a
plain preset: the API stores the resolved panel and rubric exactly as it always
has, so a pack is a starting point the candidate can still edit, never a lock.

The catalogue is drawn from a campus placement board, so the tracks match what
graduates are actually interviewed for rather than a generic role taxonomy.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class CodingProfile:
    """The editor configuration a pack needs, or absence of one."""

    languages: tuple[str, ...]
    default_language: str
    prompt: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "languages": list(self.languages),
            "default_language": self.default_language,
            "prompt": self.prompt,
        }


@dataclass(frozen=True, slots=True)
class RolePack:
    id: str
    label: str
    family: str
    summary: str
    panel: list[dict[str, Any]]
    rubric: list[dict[str, Any]]
    enabled_tools: list[str] = field(default_factory=lambda: ["knowledge_search", "calculator"])
    # The four seniority tiers this track hires at, weakest to strongest. The
    # wizard shows these instead of a product ladder, so an SDE interview never
    # tells its panel the candidate is targeting a Senior Product Manager role.
    levels: tuple[str, str, str, str] = ("Entry level", "Mid level", "Senior", "Lead")
    coding: CodingProfile | None = None

    @property
    def supports_coding(self) -> bool:
        return self.coding is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "family": self.family,
            "summary": self.summary,
            "panel": self.panel,
            "rubric": self.rubric,
            "enabled_tools": list(self.enabled_tools),
            "levels": list(self.levels),
            "supports_coding": self.supports_coding,
            "coding": self.coding.as_dict() if self.coding else None,
        }


def _panelist(
    pack_id: str,
    slug: str,
    display_name: str,
    role: str,
    expertise: list[str],
    voice: str,
    mood: str,
    behavior: str,
    interruption_style: str,
    allowed_tools: list[str],
) -> dict[str, Any]:
    return {
        # Product management keeps bare ids because its panel predates role packs
        # and is still referenced by saved configurations.
        "id": f"{pack_id}-{slug}" if pack_id else slug,
        "display_name": display_name,
        "role": role,
        "expertise": expertise,
        "voice": voice,
        "mood": mood,
        "behavior": behavior,
        "interruption_style": interruption_style,
        "allowed_tools": allowed_tools,
    }


def _rubric(*items: tuple[str, str, float, str]) -> list[dict[str, Any]]:
    """Build a rubric, asserting the weights are a real distribution."""
    total = sum(weight for _, _, weight, _ in items)
    if not 0.99 <= total <= 1.01:
        raise ValueError(f"rubric weights must total 1, got {total}")
    return [
        {"key": key, "label": label, "weight": weight, "description": description}
        for key, label, weight, description in items
    ]


_PRODUCT_MANAGEMENT = RolePack(
    id="product_management",
    label="Product Management",
    family="Product & Strategy",
    summary="Product sense, prioritization, and metric judgment for associate and senior PM loops.",
    levels=(
        "Associate PM",
        "Product Manager",
        "Senior Product Manager",
        "Lead or Group PM",
    ),
    panel=[
        _panelist(
            "", "hiring-manager", "Maya Chen", "Hiring Manager",
            ["leadership", "strategy", "communication"],
            "indian-calm", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "", "product-sense", "Noah Williams", "Product Sense Interviewer",
            ["customer insight", "prioritization", "product judgment"],
            "indian-advisor", "curious", "probing", "clarifying",
            ["knowledge_search", "web_search"],
        ),
        _panelist(
            "", "analytics", "Priya Rao", "Analytics Interviewer",
            ["metrics", "experimentation", "estimation"],
            "indian-anchor", "focused", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        ("product_judgment", "Product judgment", 0.25, "Frames customer problems and makes coherent product choices."),
        ("execution", "Execution", 0.2, "Prioritizes, scopes, and handles tradeoffs."),
        ("analytics", "Analytics", 0.2, "Uses metrics, experiments, and quantitative reasoning."),
        ("leadership", "Leadership", 0.2, "Influences stakeholders and learns from conflict."),
        ("communication", "Communication", 0.15, "Communicates structured, concise, evidence-backed answers."),
    ),
)

_SOFTWARE_ENGINEERING = RolePack(
    id="software_engineering",
    label="Software Engineering",
    family="Engineering",
    summary="Data structures, system design, and code quality for SDE and full-stack graduate loops.",
    levels=(
        "Intern or graduate",
        "Software Engineer",
        "Senior Software Engineer",
        "Staff or Lead Engineer",
    ),
    panel=[
        _panelist(
            "swe", "eng-manager", "Arjun Mehta", "Engineering Manager",
            ["team delivery", "ownership", "incident response"],
            "indian-advisor", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "swe", "staff-engineer", "Sneha Iyer", "Staff Engineer",
            ["data structures", "algorithms", "code quality"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "swe", "systems", "Daniel Okafor", "Systems Architect",
            ["distributed systems", "scalability", "storage"],
            "indian-deep", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator", "web_search"],
        ),
    ],
    rubric=_rubric(
        (
            "problem_decomposition",
            "Problem decomposition",
            0.25,
            "Breaks an ambiguous problem into tractable, well-ordered parts.",
        ),
        ("code_quality", "Code quality", 0.2, "Writes correct, readable code with sensible naming and structure."),
        (
            "complexity_reasoning",
            "Complexity reasoning",
            0.2,
            "Reasons explicitly about time, space, and the cost of chosen data structures.",
        ),
        (
            "system_design",
            "System design",
            0.2,
            "Designs components, interfaces, and failure behaviour at realistic scale.",
        ),
        (
            "communication",
            "Communication",
            0.15,
            "Narrates reasoning while working and responds precisely to challenge.",
        ),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
    coding=CodingProfile(
        languages=("python", "java", "cpp", "javascript", "typescript", "go", "rust", "csharp", "sql"),
        default_language="python",
        prompt="Write your solution here. Talk through it as you go — the panel reads the editor live.",
    ),
)

_DATA_SCIENCE = RolePack(
    id="data_science",
    label="Data Science & Analytics",
    family="Data & AI",
    summary="Metric selection, experiment design, and SQL fluency for analyst and data scientist loops.",
    levels=(
        "Graduate analyst",
        "Data Scientist",
        "Senior Data Scientist",
        "Lead Data Scientist",
    ),
    panel=[
        _panelist(
            "ds", "ds-lead", "Ananya Krishnan", "Data Science Lead",
            ["statistical modelling", "causal inference", "forecasting"],
            "indian-calm", "professional", "evidence-seeking", "contextual",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ds", "product-analyst", "Rahul Verma", "Product Analyst",
            ["metrics", "experimentation", "SQL"],
            "indian-anchor", "curious", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ds", "stakeholder", "Farah Siddiqui", "Business Stakeholder",
            ["commercial impact", "decision quality", "communication"],
            "indian-bright", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        ("metric_selection", "Metric selection", 0.25, "Chooses north stars and guardrails that survive scrutiny."),
        (
            "experiment_design",
            "Experiment design",
            0.2,
            "Designs valid tests with power, control, and a stated decision rule.",
        ),
        (
            "statistical_reasoning",
            "Statistical reasoning",
            0.2,
            "Handles uncertainty, confounding, and inference honestly.",
        ),
        ("data_fluency", "Data fluency", 0.2, "Manipulates and queries data correctly and efficiently."),
        ("communication", "Communication", 0.15, "Translates analysis into a decision a stakeholder can act on."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("python", "sql", "r"),
        default_language="sql",
        prompt="Write the query or analysis here. The panel reads it live and will ask about your choices.",
    ),
)

_MACHINE_LEARNING = RolePack(
    id="machine_learning",
    label="Machine Learning & AI",
    family="Data & AI",
    summary="Modelling judgment, evaluation, and deployment reality for ML, NLP, and applied AI loops.",
    levels=(
        "Intern or graduate",
        "ML Engineer",
        "Senior ML Engineer",
        "Staff ML Engineer",
    ),
    panel=[
        _panelist(
            "ml", "ml-manager", "Vikram Desai", "ML Engineering Manager",
            ["productionization", "MLOps", "team delivery"],
            "indian-advisor", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "ml", "research", "Lena Petrova", "Research Scientist",
            ["model architecture", "training dynamics", "evaluation"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator", "web_search"],
        ),
        _panelist(
            "ml", "applied", "Karthik Subramanian", "Applied Scientist",
            ["feature engineering", "data quality", "offline-online gap"],
            "indian-deep", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "modelling_judgment",
            "Modelling judgment",
            0.25,
            "Selects approaches proportionate to the data and the problem.",
        ),
        ("evaluation_rigor", "Evaluation rigor", 0.25, "Defines honest metrics, baselines, and failure analysis."),
        (
            "engineering_reality",
            "Engineering reality",
            0.2,
            "Accounts for latency, cost, drift, and serving constraints.",
        ),
        (
            "depth_of_fundamentals",
            "Depth of fundamentals",
            0.15,
            "Explains the mathematics and mechanics behind the choices.",
        ),
        (
            "communication",
            "Communication",
            0.15,
            "Explains tradeoffs clearly to technical and non-technical listeners.",
        ),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
    coding=CodingProfile(
        languages=("python", "sql", "cpp"),
        default_language="python",
        prompt="Sketch the model, the training loop, or the evaluation here. The panel reads it live.",
    ),
)

_QUANTITATIVE_FINANCE = RolePack(
    id="quantitative_finance",
    label="Quantitative Finance",
    family="Finance & Trading",
    summary="Probability, mental maths, and strategy reasoning for quant research and trading loops.",
    levels=(
        "Intern or graduate",
        "Quantitative Analyst",
        "Senior Quantitative Researcher",
        "Desk Lead",
    ),
    panel=[
        _panelist(
            "quant", "desk-head", "Rohan Malhotra", "Desk Head",
            ["risk", "capital allocation", "decision under pressure"],
            "indian-deep", "demanding", "challenging", "contextual",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "quant", "researcher", "Yuki Tanaka", "Quantitative Researcher",
            ["probability", "stochastic processes", "signal research"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "quant", "developer", "Ishaan Kapoor", "Quant Developer",
            ["low-latency systems", "numerical methods", "backtesting"],
            "indian-advisor", "curious", "evidence-seeking", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "probability_reasoning",
            "Probability reasoning",
            0.3,
            "Reasons correctly about randomness, expectation, and conditioning.",
        ),
        ("quantitative_speed", "Quantitative speed", 0.2, "Estimates and computes accurately under time pressure."),
        ("strategy_judgment", "Strategy judgment", 0.2, "Evaluates edge, risk, and the cost of being wrong."),
        ("implementation", "Implementation", 0.15, "Turns a model into code that is correct and fast enough."),
        ("communication", "Communication", 0.15, "States assumptions and reasoning explicitly under challenge."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("python", "cpp", "sql"),
        default_language="python",
        prompt="Implement the estimator, simulation, or pricing routine here.",
    ),
)

_CONSULTING = RolePack(
    id="consulting",
    label="Consulting & Business Analysis",
    family="Product & Strategy",
    summary="Case structuring, market sizing, and synthesis for consulting and business analyst loops.",
    levels=(
        "Business Analyst",
        "Consultant",
        "Senior Consultant",
        "Engagement Manager",
    ),
    panel=[
        _panelist(
            "con", "partner", "Elena Rossi", "Partner",
            ["client judgment", "commercial impact", "synthesis"],
            "indian-deep", "demanding", "challenging", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "con", "engagement-manager", "Aditya Sharma", "Engagement Manager",
            ["case structuring", "hypothesis testing", "workplanning"],
            "indian-advisor", "professional", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "con", "client", "Grace Mbeki", "Client Executive",
            ["operational reality", "feasibility", "stakeholder buy-in"],
            "indian-bright", "curious", "evidence-seeking", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "structuring",
            "Structuring",
            0.3,
            "Builds a mutually exclusive, collectively exhaustive approach to the case.",
        ),
        (
            "quantitative_reasoning",
            "Quantitative reasoning",
            0.25,
            "Sizes markets and runs numbers without losing the thread.",
        ),
        ("business_judgment", "Business judgment", 0.2, "Reaches recommendations that hold up commercially."),
        ("synthesis", "Synthesis", 0.15, "Lands an answer first, then supports it."),
        ("communication", "Communication", 0.1, "Stays clear and client-ready under interruption."),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
)

_HARDWARE_VLSI = RolePack(
    id="hardware_vlsi",
    label="Hardware & VLSI",
    family="Engineering",
    summary="Digital design, verification, and timing for ASIC, RTL, and physical design loops.",
    levels=(
        "Graduate Design Engineer",
        "Design Engineer",
        "Senior Design Engineer",
        "Staff or Lead Engineer",
    ),
    panel=[
        _panelist(
            "vlsi", "design-manager", "Sanjay Pillai", "Design Manager",
            ["tapeout delivery", "design tradeoffs", "cross-team execution"],
            "indian-advisor", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "vlsi", "rtl-lead", "Mei Lin Chow", "RTL Design Lead",
            ["digital design", "microarchitecture", "timing closure"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "vlsi", "verification", "Omar Haddad", "Verification Lead",
            ["functional verification", "coverage", "assertions"],
            "indian-deep", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "digital_fundamentals",
            "Digital fundamentals",
            0.25,
            "Commands combinational and sequential logic, FSMs, and CDC.",
        ),
        ("microarchitecture", "Microarchitecture", 0.25, "Reasons about pipelines, hazards, area, power, and timing."),
        (
            "verification_mindset",
            "Verification mindset",
            0.2,
            "Thinks in corner cases, coverage, and provable correctness.",
        ),
        ("implementation", "Implementation", 0.15, "Writes synthesizable, clean RTL."),
        ("communication", "Communication", 0.15, "Explains design intent and tradeoffs precisely."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("verilog", "systemverilog", "vhdl", "cpp", "python"),
        default_language="verilog",
        prompt="Write the RTL or testbench here. The panel reads it live.",
    ),
)

_EMBEDDED_SYSTEMS = RolePack(
    id="embedded_systems",
    label="Embedded Systems",
    family="Engineering",
    summary="Firmware, real-time constraints, and hardware interfacing for embedded and robotics loops.",
    levels=(
        "Graduate Firmware Engineer",
        "Embedded Engineer",
        "Senior Embedded Engineer",
        "Firmware Lead",
    ),
    panel=[
        _panelist(
            "emb", "firmware-manager", "Nikhil Joshi", "Firmware Manager",
            ["product bring-up", "release discipline", "field debugging"],
            "indian-advisor", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "emb", "rtos-engineer", "Clara Nunes", "Senior Embedded Engineer",
            ["RTOS", "interrupts", "memory constraints"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "emb", "hardware", "Tarun Balakrishnan", "Hardware Integration Lead",
            ["peripherals", "signal integrity", "power budgets"],
            "indian-deep", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "systems_fundamentals",
            "Systems fundamentals",
            0.25,
            "Understands memory, concurrency, and the hardware boundary.",
        ),
        (
            "real_time_reasoning",
            "Real-time reasoning",
            0.25,
            "Reasons about latency, determinism, interrupts, and scheduling.",
        ),
        ("debugging", "Debugging", 0.2, "Isolates faults methodically across hardware and software."),
        ("implementation", "Implementation", 0.15, "Writes defensive, resource-aware C."),
        ("communication", "Communication", 0.15, "Explains constraints and tradeoffs clearly."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("c", "cpp", "python", "rust", "verilog"),
        default_language="c",
        prompt="Write the driver, ISR, or state machine here. The panel reads it live.",
    ),
)

_CLOUD_DEVOPS = RolePack(
    id="cloud_devops",
    label="Cloud & DevOps",
    family="Engineering",
    summary="Reliability, automation, and incident response for SRE, platform, and cloud loads.",
    levels=(
        "Graduate Cloud Engineer",
        "Cloud or DevOps Engineer",
        "Senior Site Reliability Engineer",
        "Platform Lead",
    ),
    panel=[
        _panelist(
            "cloud", "platform-manager", "Deepa Menon", "Platform Engineering Manager",
            ["reliability targets", "on-call health", "cost control"],
            "indian-calm", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "cloud", "sre", "Marcus Boateng", "Site Reliability Engineer",
            ["observability", "incident response", "capacity planning"],
            "indian-deep", "focused", "challenging", "evidence-gap",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "cloud", "infra", "Ritika Bansal", "Infrastructure Engineer",
            ["infrastructure as code", "containers", "networking"],
            "indian-anchor", "curious", "probing", "clarifying",
            ["knowledge_search", "calculator", "web_search"],
        ),
    ],
    rubric=_rubric(
        (
            "reliability_thinking",
            "Reliability thinking",
            0.25,
            "Designs for failure with SLOs, blast radius, and graceful degradation.",
        ),
        ("systems_depth", "Systems depth", 0.25, "Commands Linux, networking, and container fundamentals."),
        ("automation", "Automation", 0.2, "Removes toil with reproducible, reviewable infrastructure."),
        ("incident_response", "Incident response", 0.15, "Debugs live systems calmly and follows evidence."),
        ("communication", "Communication", 0.15, "Reports status and risk clearly under pressure."),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
    coding=CodingProfile(
        languages=("python", "bash", "yaml", "go", "sql"),
        default_language="bash",
        prompt="Write the script, manifest, or query here. The panel reads it live.",
    ),
)

_CORE_ENGINEERING = RolePack(
    id="core_engineering",
    label="Core & Mechanical Engineering",
    family="Core Engineering",
    summary="Engineering fundamentals, manufacturing judgment, and project depth for core graduate roles.",
    levels=(
        "Graduate Trainee Engineer",
        "Engineer",
        "Senior Engineer",
        "Engineering Lead",
    ),
    panel=[
        _panelist(
            "core", "plant-manager", "Harish Nair", "Plant Operations Manager",
            ["manufacturing", "quality systems", "safety"],
            "indian-advisor", "professional", "evidence-seeking", "contextual",
            ["knowledge_search"],
        ),
        _panelist(
            "core", "design-engineer", "Isabel Ferreira", "Senior Design Engineer",
            ["mechanical design", "materials", "tolerance analysis"],
            "indian-anchor", "focused", "probing", "clarifying",
            ["knowledge_search", "calculator"],
        ),
        _panelist(
            "core", "graduate-lead", "Suresh Ramanathan", "Graduate Programme Lead",
            ["project depth", "learning agility", "teamwork"],
            "indian-calm", "curious", "evidence-seeking", "evidence-gap",
            ["knowledge_search"],
        ),
    ],
    rubric=_rubric(
        (
            "engineering_fundamentals",
            "Engineering fundamentals",
            0.3,
            "Applies core mechanics, thermodynamics, and materials correctly.",
        ),
        (
            "applied_problem_solving",
            "Applied problem solving",
            0.25,
            "Turns first principles into a workable engineering answer.",
        ),
        ("project_depth", "Project depth", 0.2, "Owns and explains prior projects with real technical detail."),
        ("practical_judgment", "Practical judgment", 0.1, "Weighs cost, manufacturability, and safety."),
        ("communication", "Communication", 0.15, "Explains technical work clearly to a mixed audience."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
)

ROLE_PACKS: dict[str, RolePack] = {
    pack.id: pack
    for pack in (
        _PRODUCT_MANAGEMENT,
        _SOFTWARE_ENGINEERING,
        _DATA_SCIENCE,
        _MACHINE_LEARNING,
        _QUANTITATIVE_FINANCE,
        _CONSULTING,
        _HARDWARE_VLSI,
        _EMBEDDED_SYSTEMS,
        _CLOUD_DEVOPS,
        _CORE_ENGINEERING,
    )
}

DEFAULT_ROLE_PACK_ID = "product_management"
ROLE_PACK_IDS: frozenset[str] = frozenset(ROLE_PACKS)

# Every language any pack can offer. The editor validates against this, so a
# language reaches the panel only if some track actually interviews in it.
SUPPORTED_LANGUAGES: frozenset[str] = frozenset(
    language for pack in ROLE_PACKS.values() if pack.coding for language in pack.coding.languages
)


def get_role_pack(pack_id: str | None) -> RolePack:
    """Resolve a pack id, falling back to the default rather than failing a session."""
    return ROLE_PACKS.get(pack_id or "", ROLE_PACKS[DEFAULT_ROLE_PACK_ID])


def supports_coding(pack_id: str | None) -> bool:
    return get_role_pack(pack_id).supports_coding


def catalog() -> list[dict[str, Any]]:
    """The full catalogue, default track first, then grouped stably by family."""
    packs = list(ROLE_PACKS.values())
    packs.sort(key=lambda pack: (pack.id != DEFAULT_ROLE_PACK_ID, pack.family, pack.label))
    return [pack.as_dict() for pack in packs]
