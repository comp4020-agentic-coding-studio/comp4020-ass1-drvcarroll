# Assignment 1

## What was the breakthrough that moved the work forward?

The biggest breakthrough was a technique i learnt from a classmate that enabled the complete rebuild of my assignment from scratch on such short notice. By spending about 20 to 30 minutes creating a detailed description of the final goal, and chunking into discrete steps, 
and ensuring that after every step claude reviews its own work against things like the spec, the brief, user interface and coding design pricniples, I could essentially one-shot the majority of the application. I generalised this behaviour and saved it in `CLAUDE.md`, such that even on smaller scale tasks there would still be a structured build process. This resulted in a far more automated building process, in which the quality of the output was much higher, cohesive, and aligned with my intentions and the specifications provided. This let me build things much quicker, and the increased clarity at the start tends to avoid the horrible back and forth trying to iron out the nitty gritty details.

This unfortunately still which still ended up happening, purely because I didnt spend enough time planning out the project in the first place, and my initial design brief lacked clarity. I was still subjected a final back-and-forth with Claude to iron out all the bugs, make the interactivity cleaner, and design a clean, intuitive "tutorial" feel for the web app; This was a lot of manual work to make it feel polished and functional, however, most of this is because I lacked a clear end product in my initial prompt. Should i have been more definitive, had Claude design more unit tests, and design the project from the ground up myself before moving to LLMs as a workhorse, i could have avoided all this. 

As a result, I have noticed a tension between using LLMs as a creative partner, but ending up with a poor end product due to a messy iterative process, or using LLMs as a workhorse to exact a pre-meditated vision, which is cleaner and easier, but requires more preparation and system design beforehand.

## What did this work change about who I want to be as a software developer?

To be honest, I have been quite discouraged with my programming projects as of late. It has been difficult to shake the feeling that in the next few years, everything will be vibe coded, and software development as we know it will mutate and evolve into something different, and leave a lot of people behind. 

*Some days I worry AI will take my job. Today was not one of those days.*

Every time i work with Claude (be it Opus or Sonnet) I am reminded that these LLMs are still very, very far away from desinging robust, secure, functional code that can actually be interacted with by other humans, without human oversight. All the projects for this course as thusfar reinforced the fact that good systems design, careful architecture, and good coding practices are still crucial, and even necessary, to do things efficiently with LLMS, and planning beforehand is the key. 

As such, I want to be a software developer that sits down and designs a complete, functional, and robust system, using good software architecture techniques; I want to avoid overengineering solutions, but ensure enough flex is built in to any system such that it can handle inevitable change. After that process, I am comfortable using LLMs to direct my vision and enact my goals while sparing me tedious labour. I would also like to have a more hands-on role in the coding process, through regular reviews of AI generated code to ensure the quality remains acceptable. 
