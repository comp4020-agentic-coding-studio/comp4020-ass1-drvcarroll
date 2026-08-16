# Process overview

## What I built

An interactive explainer for git, built around one claim: **your code is on your
machine.** It opens on two icons and a gap — a laptop, and a server behind a
dotted line — and everything else is something you open. Inside the laptop are
your files, the index and `.git`, drawn as the same cylinder as the server,
because the misconception being attacked is that history lives on GitHub. You
edit a real file, stage it, and seal it into a commit whose id is a hash of its
contents. Only two commands cross the gap.

## The moments that mattered

#### 1. 
 
The UI claude creates is shit. I built styleguides into claude.md to try fix this, the compress then
condense section, which tries to instill cleaner, better information heirarchy into the web app. 
will be keeping this in the future, and probably will reword it stronger and add more UI design
principles as they get ignored.

#### 2, 

The DNS (my first example) was not interactive enough. i built pointers into claude md for 
navigation to drive the experience, not narration (manipulation, not narration). also 
switched to git, as I realised that DNS was probably limited in how interactive i could make it,
and wanted somethign really user driven.

#### 3. 

i decided to up my game, and try one-shot the funcitonality more by brain dumping a plan, and 
letting claude convert it into chunks or steps, and after each step check the progress, 
reflect, review, ensure no drift, ensure the code was clean, etc. this way it sort of loops over 
its own work in an iterative process. i saved this in BUILD_PLAN.md, but moving forward i will try 
and generalise this process and fit it into claude.md. 

#### 4. 

claude is still shit at UI design. i had to do the redisgn myself for the final UI look. even installing  agent browser didnt work. actually had to a lot of teh coding myself as sonnet is shit.
this moment is important - you cannot give the model too much agency. you have to very clearly define
the UI and infomraton heirarchy. 