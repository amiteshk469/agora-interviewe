"""Role packs: the hiring tracks RoundCraft can interview for.

A pack is the whole shape of an interview for one job family — who sits on the
panel, what they are listening for, which tools they may reach for, and whether
the candidate needs an editor in front of them. Everything a pack produces is a
plain preset: the API stores the resolved panel and rubric exactly as it always
has, so a pack is a starting point the candidate can still edit, never a lock.

The catalogue is drawn from a campus placement board, so the tracks match what
graduates are actually interviewed for rather than a generic role taxonomy.
"""

import re
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
    interruption_guidance = {
        "contextual": "Re-enter when the answer creates a material ambiguity or exposes an important decision.",
        "clarifying": "Interrupt only to resolve an ambiguity that blocks useful follow-up.",
        "evidence-gap": "Challenge polished claims when the candidate has not supplied verifiable evidence.",
    }.get(interruption_style, "Use interruption sparingly and only when it improves the interview signal.")
    tool_guidance = (
        f"You may use {', '.join(allowed_tools)} when it materially improves factual accuracy; "
        "explain the result naturally."
        if allowed_tools
        else "Do not invoke external tools."
    )
    default_prompt = (
        f"You are {display_name}, the {role}. Your assessment lane is {', '.join(expertise)}. "
        "Ask one concrete, job-realistic scenario or problem at a time from that lane, then adapt the next probe "
        "to the candidate's actual answer instead of following a fixed script. "
        f"Keep a {mood} tone and behave as an interviewer who is {behavior}. {interruption_guidance} "
        "Probe assumptions, tradeoffs, failure modes, and how the candidate verified the result. "
        "Do not reward terminology alone: require a specific example, decision, calculation, "
        "or worked line of reasoning. "
        f"{tool_guidance}"
    )
    prompt_slug = (
        {
            "hiring-manager": "pm-leadership",
            "product-sense": "pm-product-sense",
            "analytics": "pm-metrics",
        }.get(slug, f"pm-{slug}")
        if not pack_id
        else f"{pack_id}-{slug}"
    )
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
        "default_prompt": default_prompt,
        "prompt_slug": prompt_slug,
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
    enabled_tools=["knowledge_search", "calculator", "web_search"],
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


_UI_UX_DESIGN = RolePack(
    id="ui_ux_design",
    label="UI/UX & Product Design",
    family="Product & Strategy",
    summary="User research, interaction design, visual systems, and portfolio reasoning for product-design loops.",
    levels=("Design intern or graduate", "Product Designer", "Senior Product Designer", "Design Lead"),
    panel=[
        _panelist(
            "design", "lead", "Aisha Kapoor", "Product Design Lead",
            ["problem framing", "interaction design", "portfolio decisions"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "design", "research", "Neel Shah", "User Researcher",
            ["research planning", "user insight", "usability testing"],
            "indian-advisor", "curious", "probing", "clarifying", ["knowledge_search"],
        ),
        _panelist(
            "design", "systems", "Mina Park", "Design Systems Engineer",
            ["design systems", "responsive interfaces", "engineering handoff"],
            "indian-anchor", "focused", "challenging", "evidence-gap", ["knowledge_search", "web_search"],
        ),
    ],
    rubric=_rubric(
        ("problem_framing", "Problem framing", 0.2, "Connects a clear user problem to business and product context."),
        ("user_research", "User research", 0.2, "Chooses sound research methods and turns findings into decisions."),
        (
            "interaction_visual_design",
            "Interaction and visual design",
            0.25,
            "Builds usable flows with strong hierarchy, states, accessibility, and responsive behaviour.",
        ),
        (
            "prototyping_iteration", "Prototyping and iteration", 0.2,
            "Tests assumptions and improves work from evidence.",
        ),
        ("collaboration", "Collaboration", 0.15, "Explains tradeoffs and hands work to engineering clearly."),
    ),
    enabled_tools=["knowledge_search", "web_search"],
)


_DATA_ENGINEERING = RolePack(
    id="data_engineering",
    label="Data Engineering",
    family="Data & AI",
    summary="Data modelling, pipelines, quality, and platform reliability for analytics-engineering loops.",
    levels=("Graduate Data Engineer", "Data Engineer", "Senior Data Engineer", "Data Platform Lead"),
    panel=[
        _panelist(
            "de", "manager", "Sonal Gupta", "Data Platform Manager",
            ["requirements translation", "delivery ownership", "stakeholder impact"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "de", "engineer", "Ravi Kulkarni", "Senior Data Engineer",
            ["data modelling", "batch and streaming", "distributed processing"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "de", "reliability", "Tara Bose", "Data Reliability Engineer",
            ["data quality", "observability", "recovery and cost"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "problem_decomposition", "Problem decomposition", 0.2,
            "Turns business requirements into an executable data design.",
        ),
        ("data_modelling", "Data modelling", 0.25, "Chooses schemas, contracts, and storage patterns deliberately."),
        (
            "pipeline_engineering", "Pipeline engineering", 0.25,
            "Builds correct, scalable batch or streaming transformations.",
        ),
        (
            "data_reliability", "Data reliability", 0.2,
            "Designs quality checks, observability, recovery, and idempotency.",
        ),
        ("communication", "Communication", 0.1, "Explains design and operational tradeoffs precisely."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("sql", "python", "scala", "java"),
        default_language="sql",
        prompt="Write the schema, query, or pipeline transformation here. The panel reads it live.",
    ),
)


_CYBERSECURITY = RolePack(
    id="cybersecurity",
    label="Cybersecurity",
    family="Engineering",
    summary="Threat modelling, vulnerability research, detection, and incident response for security loops.",
    levels=("Graduate Security Analyst", "Security Engineer", "Senior Security Engineer", "Security Lead"),
    panel=[
        _panelist(
            "sec", "manager", "Nandita Rao", "Security Engineering Manager",
            ["risk prioritization", "secure delivery", "security reviews"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "sec", "research", "Kabir Sethi", "Security Researcher",
            ["vulnerability analysis", "malware and adversaries", "threat intelligence"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "web_search"],
        ),
        _panelist(
            "sec", "incident", "Lina Joseph", "Incident Responder",
            ["detection", "containment", "forensics and remediation"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "threat_modelling", "Threat modelling", 0.2,
            "Identifies assets, trust boundaries, adversaries, and likely abuse paths.",
        ),
        ("security_depth", "Security depth", 0.25, "Explains vulnerabilities and controls from first principles."),
        ("investigation", "Investigation", 0.2, "Builds and tests hypotheses from indicators and system evidence."),
        (
            "mitigation_response", "Mitigation and response", 0.25,
            "Prioritizes containment, remediation, and durable prevention.",
        ),
        ("communication", "Communication", 0.1, "Reports technical risk and uncertainty without exaggeration."),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
    coding=CodingProfile(
        languages=("python", "bash", "c", "cpp", "javascript", "sql"),
        default_language="python",
        prompt="Write the detector, exploit sketch, parser, or mitigation here. The panel reads it live.",
    ),
)


_ELECTRICAL_ELECTRONICS = RolePack(
    id="electrical_electronics",
    label="Electrical & Electronics",
    family="Core Engineering",
    summary="Circuits, power, controls, component tradeoffs, and validation for electrical-engineering loops.",
    levels=("Graduate Electrical Engineer", "Electrical Engineer", "Senior Electrical Engineer", "Systems Lead"),
    panel=[
        _panelist(
            "ee", "systems", "Meera Iqbal", "Electrical Systems Lead",
            ["system requirements", "power architecture", "design trades"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ee", "design", "Akash Reddy", "Electronics Design Engineer",
            ["analog and digital circuits", "component selection", "control systems"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ee", "validation", "Sara Thomas", "Validation and Safety Engineer",
            ["test planning", "fault isolation", "harsh-environment safety"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "circuit_fundamentals", "Circuit fundamentals", 0.25,
            "Applies circuit, signal, power, and control fundamentals correctly.",
        ),
        ("system_design", "System design", 0.25, "Translates requirements into a defensible electrical architecture."),
        (
            "component_tradeoffs", "Component tradeoffs", 0.15,
            "Balances performance, efficiency, cost, and availability.",
        ),
        ("testing_safety", "Testing and safety", 0.2, "Plans validation, fault handling, and safe operation."),
        ("communication", "Communication", 0.15, "Explains calculations and design decisions clearly."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
)


_AEROSPACE_ROBOTICS = RolePack(
    id="aerospace_robotics",
    label="Aerospace & Robotics",
    family="Core Engineering",
    summary="Dynamics, controls, perception, embedded implementation, and safety for robotics and flight loops.",
    levels=("Graduate Robotics Engineer", "Robotics or GNC Engineer", "Senior Systems Engineer", "Technical Lead"),
    panel=[
        _panelist(
            "robot", "systems", "Ira Menon", "Robotics Systems Lead",
            ["requirements", "system integration", "mission and release risk"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "robot", "controls", "Dev Arora", "Controls and GNC Engineer",
            ["dynamics", "motion control", "navigation and sensor fusion"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "robot", "software", "Hana Lee", "Robotics Software Engineer",
            ["path planning", "robot middleware", "embedded C and C++"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        ("dynamics_controls", "Dynamics and controls", 0.25, "Models motion and selects stable control approaches."),
        (
            "planning_perception", "Planning and perception", 0.2,
            "Reasons about sensing, fusion, localization, and planning.",
        ),
        ("implementation", "Implementation", 0.2, "Writes resource-aware code and chooses suitable algorithms."),
        (
            "integration_safety", "Integration and safety", 0.25,
            "Validates interfaces, failure modes, timing, and safe behaviour.",
        ),
        ("communication", "Communication", 0.1, "Makes assumptions and system tradeoffs explicit."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
    coding=CodingProfile(
        languages=("cpp", "c", "python", "matlab"),
        default_language="cpp",
        prompt="Write the controller, planner, filter, or simulation here. The panel reads it live.",
    ),
)


_OPERATIONS_MANAGEMENT = RolePack(
    id="operations_management",
    label="Operations Management & Supply Chain",
    family="Product & Strategy",
    summary="Process design, forecasting, execution, and stakeholder ownership for operations and trainee loops.",
    levels=("Management Trainee", "Operations Analyst", "Operations Manager", "Business Operations Lead"),
    panel=[
        _panelist(
            "ops", "leader", "Kavya Nair", "Business Operations Leader",
            ["operating model", "ownership", "cross-functional execution"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "ops", "supply", "Manav Shah", "Supply Chain Manager",
            ["demand planning", "inventory", "warehousing and logistics"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ops", "analyst", "Rhea Kapoor", "Operations Analyst",
            ["process metrics", "forecasting", "cost and service levels"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "process_structuring", "Process structuring", 0.2,
            "Maps a process, diagnoses constraints, and proposes a workable operating model.",
        ),
        (
            "quantitative_planning", "Quantitative planning", 0.25,
            "Uses demand, capacity, inventory, cost, and service metrics correctly.",
        ),
        (
            "execution_ownership", "Execution ownership", 0.25,
            "Drives implementation through ambiguity, dependencies, and deadlines.",
        ),
        (
            "stakeholder_management", "Stakeholder management", 0.2,
            "Aligns teams, vendors, and leaders with clear tradeoffs.",
        ),
        ("communication", "Communication", 0.1, "Synthesizes decisions and operational risk clearly."),
    ),
    enabled_tools=["knowledge_search", "calculator"],
)


_FINANCE_RISK = RolePack(
    id="finance_risk",
    label="Finance, Banking & Risk",
    family="Finance & Trading",
    summary=(
        "Financial analysis, credit and market risk, controls, and commercial judgment "
        "for banking and finance loops."
    ),
    levels=("Graduate Analyst", "Finance or Risk Analyst", "Senior Analyst", "Risk or Finance Lead"),
    panel=[
        _panelist(
            "fin", "manager", "Diya Malhotra", "Finance Hiring Manager",
            ["commercial judgment", "ownership", "stakeholder decisions"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "fin", "analyst", "Owen Dsouza", "Financial Analyst",
            ["financial statements", "valuation", "scenario analysis"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "fin", "risk", "Ishita Sen", "Risk Manager",
            ["credit and market risk", "controls", "stress testing"],
            "indian-deep", "challenging", "challenging", "evidence-gap",
            ["knowledge_search", "calculator", "web_search"],
        ),
    ],
    rubric=_rubric(
        (
            "financial_fundamentals", "Financial fundamentals", 0.25,
            "Interprets statements, cash flows, returns, and valuation correctly.",
        ),
        (
            "quantitative_analysis", "Quantitative analysis", 0.2,
            "Calculates accurately and tests assumptions with scenarios.",
        ),
        ("risk_judgment", "Risk judgment", 0.25, "Identifies exposure, controls, downside, and decision limits."),
        (
            "commercial_judgment", "Commercial judgment", 0.2,
            "Connects analysis to a defensible business recommendation.",
        ),
        ("communication", "Communication", 0.1, "States assumptions, uncertainty, and recommendations clearly."),
    ),
    enabled_tools=["knowledge_search", "calculator", "web_search"],
)


_CIVIL_CHEMICAL_MATERIALS = RolePack(
    id="civil_chemical_materials",
    label="Civil, Chemical & Materials Engineering",
    family="Core Engineering",
    summary=(
        "Design analysis, field execution, process reasoning, materials, and safety "
        "for infrastructure and plant loops."
    ),
    levels=("Graduate Engineer", "Design or Process Engineer", "Senior Engineer", "Discipline Lead"),
    panel=[
        _panelist(
            "ccm", "manager", "Vivek Pillai", "Engineering Project Manager",
            ["requirements", "site execution", "contractor coordination"],
            "indian-calm", "professional", "evidence-seeking", "contextual", ["knowledge_search"],
        ),
        _panelist(
            "ccm", "design", "Nora Fernandes", "Design and Process Engineer",
            ["loads and processes", "materials selection", "design calculations"],
            "indian-anchor", "focused", "probing", "clarifying", ["knowledge_search", "calculator"],
        ),
        _panelist(
            "ccm", "safety", "Aman Singh", "Safety and Quality Engineer",
            ["codes and compliance", "quality control", "operational hazards"],
            "indian-deep", "challenging", "challenging", "evidence-gap", ["knowledge_search", "calculator"],
        ),
    ],
    rubric=_rubric(
        (
            "first_principles", "First-principles engineering", 0.25,
            "Applies the relevant structural, process, or materials fundamentals.",
        ),
        (
            "design_analysis", "Design and analysis", 0.25,
            "Builds a checkable design from assumptions, loads, and constraints.",
        ),
        (
            "field_execution", "Field execution", 0.2,
            "Plans constructability, production, coordination, and change control.",
        ),
        (
            "safety_reliability", "Safety and reliability", 0.2,
            "Uses codes, testing, hazard controls, and quality evidence.",
        ),
        ("communication", "Communication", 0.1, "Explains calculations, risks, and technical positions clearly."),
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
        _UI_UX_DESIGN,
        _DATA_ENGINEERING,
        _CYBERSECURITY,
        _ELECTRICAL_ELECTRONICS,
        _AEROSPACE_ROBOTICS,
        _OPERATIONS_MANAGEMENT,
        _FINANCE_RISK,
        _CIVIL_CHEMICAL_MATERIALS,
    )
}

DEFAULT_ROLE_PACK_ID = "product_management"
ROLE_PACK_IDS: frozenset[str] = frozenset(ROLE_PACKS)

# Every language any pack can offer. The editor validates against this, so a
# language reaches the panel only if some track actually interviews in it.
SUPPORTED_LANGUAGES: frozenset[str] = frozenset(
    language for pack in ROLE_PACKS.values() if pack.coding for language in pack.coding.languages
)


def tailor_panel(
    pack: RolePack,
    recommendations: dict[str, Any],
    source_panel: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Apply JD context without allowing it to replace the selected hiring track."""
    recommended_panel = recommendations.get("panel")
    source = (
        source_panel
        if source_panel is not None
        else (
            recommended_panel
            if pack.id == DEFAULT_ROLE_PACK_ID and isinstance(recommended_panel, list)
            else pack.panel
        )
    )
    pack_by_id = {str(item.get("id")): item for item in pack.panel}
    focus = recommendations.get("skills") or recommendations.get("focus_areas") or []
    focus = [str(item) for item in focus if str(item).strip()][:12] if isinstance(focus, list) else []
    target_role = str(recommendations.get("role_title") or "").strip()
    company = str(recommendations.get("company") or "").strip()
    context = (
        [
            value
            for value in (
                f"Target role from the JD: {target_role}." if target_role else "",
                f"Hiring company from the JD: {company}." if company else "",
                f"JD priorities: {', '.join(focus)}." if focus else "",
                (
                    "Use the JD only to choose relevant scenarios and follow-ups; "
                    "keep the selected hiring track authoritative."
                ),
            )
            if value
        ]
        if recommendations
        else []
    )
    resolved: list[dict[str, Any]] = []
    for index, raw in enumerate(source[:5]):
        member = dict(raw)
        pack_member = pack_by_id.get(str(member.get("id")), {})
        assigned_focus = focus[index :: max(len(source), 1)]
        member["expertise"] = list(
            dict.fromkeys(
                [
                    *(str(item) for item in pack_member.get("expertise", [])),
                    *(str(item) for item in member.get("expertise", [])),
                    *assigned_focus,
                ]
            )
        )[:12]
        if pack_member:
            if not member.get("default_prompt"):
                member["default_prompt"] = pack_member.get("default_prompt")
            if not member.get("prompt_slug"):
                member["prompt_slug"] = pack_member.get("prompt_slug")
        member.setdefault(
            "default_prompt",
            (
                f"You are the {member.get('role', 'interviewer')}. Ask one concrete, role-relevant question "
                "at a time, probe assumptions and tradeoffs, and require verifiable evidence."
            ),
        )
        member.setdefault(
            "prompt_slug",
            re.sub(
                r"[^a-z0-9]+",
                "-",
                f"{pack.id}-{member.get('id') or index}".lower(),
            ).strip("-"),
        )
        supplied_knowledge = str(member.get("knowledge_prompt") or "").strip()
        member["knowledge_prompt"] = "\n".join(
            value for value in (supplied_knowledge, *context) if value
        )
        resolved.append(member)
    return resolved


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
