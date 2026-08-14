# AI_USAGE

AI tools were used as development assistants, not as undisclosed sources of project code.

## Claude / coding assistant

Claude was used during implementation to:
- inspect the supplied codebase;
- reason about the existing architecture;
- create and modify TypeScript/React files;
- implement the benchmark/experiment infrastructure;
- improve metrics and error handling;
- identify and fix TypeScript issues;
- help integrate the experiment panel and supporting utilities.

The generated changes were reviewed and tested in the running project. The final author is responsible for the architecture, feature choices, experiment interpretation and submitted code.

## ChatGPT

ChatGPT was used to:
- reason through the assignment stages and remaining deliverables;
- formulate implementation prompts for the coding assistant;
- review experiment outputs;
- interpret rate-limit failures;
- reason about the two optimization choices;
- help structure the final documentation.

## Human decisions

The following decisions were made by the project author:
- the canvas interaction model;
- selection/context-extraction strategy;
- asynchronous AI draft behavior;
- answer placement/style/interaction;
- benchmark definitions;
- experiment variable and arms;
- optimization choices;
- interpretation of measured results;
- final feature/ideation selection;
- final testing and submission decisions.

## Important honesty note

AI-assisted code was not treated as automatically correct. The project author inspected behavior, ran the application, checked metrics, and corrected issues found during implementation. Provider errors and experiment failures were retained rather than rewritten as successful results.
