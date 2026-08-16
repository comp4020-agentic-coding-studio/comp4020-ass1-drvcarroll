# Process overview

## What I built

I built an interactive explainer for version control: how files are modified and shared collaboratively using git. The user visualises and interacts with four distinct entities:
- **Your Files:** the local machine, where files are read and modified by the user;
- **.git/index:** the git index, which tracks local changes by hash, and from which the user can stage or commit changes locally;
- **.git:** the local git repository, where the user can see commits and branches, push, pull and branch against the git server, and merge whatever they pull down;
- **Git Server:** the remote git repository, where changes are stored by all users of a collaborative project.

## The moments that mattered

#### 1.

My original idea was an interactive explainer for the Domain Name System. Having seen impressive results from classmates that came out of apparently very little planning, I decided to try to one-shot a working prototype. I brainstormed with Claude and gave it plenty of agency over the design. The result was, unsurprisingly, terrible — the user interface most of all. Two things became very clear to me:
1. LLMs are very poor at human-centred design, and do not know how to build interactive systems that work well without hand-holding.
2. I would need to write rigorous UI and general design principles into `CLAUDE.md` to get anything remotely palatable.

I added the design principles sections to `CLAUDE.md`
([100af66](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/100af66),
[31a8e8c](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/31a8e8c))
to hold the project to general usability and interface practice going forward.

This did help, for the most part — the interface became more consistent, with a cleaner and more minimal information hierarchy. It needed a few more tweaks throughout the project, but it was largely successful in aligning the output with what I wanted from the design.

#### 2.

Even after extensively modifying the DNS project, I was still unsatisfied with the result. It did not follow the spec properly; it was not interactive enough, and felt more like a click-through story than an interactive explainer. The problem was that Claude was missing the overall context and motivation. So I added the "Work against the spec and the marking criteria, every stage" section to `CLAUDE.md`
([100af66](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/100af66)),
to make it refer back to the assignment spec, and later folded a spec re-read into the per-step review gate
([ffdf73e](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/ffdf73e)).
I find this an excellent use case for editing `CLAUDE.md`: adding the information that should ground the agent at every step. It worked well, and later iterations were noticeably more interactive and engaging.

#### 3.

I realised DNS was not the best subject, as the interactive element is limited. I decided to change tack and try version control, a core part of modern software development, and something inherently user-driven, which would make it much easier to build an explainer that felt engaging and event-driven. This was an ambitious do-over
([4517df2](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/4517df2)),
so I tried a technique I learnt off a classmate to build up a solid project quickly and avoid my earlier failings. I wrote detailed `STRUCTURE.md` and `BUILD_PLAN.md` files
([fe885fb](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/fe885fb))
defining the logical structure of the project and the sequential steps to take in building it. I also added the "Work from a written plan, and review at every step" section to `CLAUDE.md`
([912cfde](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/912cfde),
[6f3d4fc](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/6f3d4fc)).
The idea was an iterative, self-reflecting loop I could leave running, constantly analysing its own progress against the spec, my intentions, the UI design principles, interactivity, and so on. This worked really well, and I had the core git prototype down after an hour or two of letting Claude run.

#### 4.

Finally, I added the "Design Principle: Test at Every Stage" section to `CLAUDE.md`, to avoid the logic bugs I kept hitting when testing the more polished product. The spec had already been locked down around the core interactions
([acc93e5](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/acc93e5),
[4b16ef3](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-drvcarroll/commit/4b16ef3)),
and requiring tests alongside each step worked quite cleanly — at the cost of a longer build process while it is coding.
