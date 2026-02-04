# Claude Tutor

Just like Waymo is a self driving system with one driver, can we create a self driving build dojo with one tutor?

The Tutor project is set to meet people where they are at, email, CLI, and in future slack, video calls, phone calls, to help them level up their skills.

We’re starting with email + CLI to see how far we can work across coordinating tutor sessions and ideas (email) and the build sessions themselves in CLI.

Just like a great tutor, Claude tutor, should be able to help 1) meet the user where they are at, 2) help them step by step and catch errors and 3) allow for progession from session to session and project to project.

The reason this is a separate agent and not a plugin for Claude Code is because there are different objective functions. Claude Code is set up to write code on behalf of users. People are saying “we don’t write code anymore.” We don’t think that makes sense. It’s like hiring interns to do production level work. It’s dependent on your knowledge to coordinate the system for specific outputs.

Claude Tutor’s goal is to help humans level up their knowledge, mindset, and skills in a more full engineering stack. It’s not about writing code, it’s about leveling up individuals for their own use case.

## 1. Onboarding = personalized projects to start at their skill level

Onboarding is set to be personalized to whatever projects someone wants to do:

- Applications (CLI, web, mobile)
- Agent building
- Or generally leveling up certain skills or information

It uses the AskUser tool from Claude Code SDK to be dynamic and fill in information.

It should be enough information for the agent to make an interesting project, get to know the user, and guarantee some kind of endpoint for the project. For example, if it’s a web app, ships first features. If it’s practicing leet code, complete first set of practices.

## 2. Project by project support = fastest way to get users to a demo-able outcome

The tutor should organize a project plan with list of tasks and code files. It breaks it down step by step for the user to be able to do 10-25min segments of step by step.

When the user asks questions or want to change things, there should be a way where new context gets injected per project.

## 3. Three modes for tutor interactions

1. **Default: Tutor mode** = step by step support. Inspired by TyperShark video games, and interactive piano visuals. The goal here is to help assist the human to make as much progress as possible. It’s like apprenticing a good engineer, by replicating line by line code. When they miss something, the tutor catches it. When they finish something, the code passes through the tutor and can run.
2. **Code mode** = more open ended. This should have directions and prompts with unit tests but not code given. Maybe there’s a hint mode, with snippets and samples, but ultimately it should be the user architecting and submitting the code.
3. **Discuss mode** = Talk freely with the tutor. Like plan mode in Claude Code, where it doesn’t touch the project, but has ability to update if user opts in.

To shift between modes right now, it’s shift + tab (like Claude Code).

### Future Features

- **Project review:** A user explains and talks through their finished project and gets feedback on how they understand how the code works. This probably wants to be voice based.
- **Project packs:** Can we set up pre-made projects that enable users to jump right into projects and skip core part of onboarding. This solves problem of not knowing where/how to start, and slow to generate new projects in beginning. Also, explore hardware project packs that connect to physical hardware.
- **Email Project Packs:** Can we set up 30 days to learn how to write your own AI Agent with Claude Code SDK? or 30 days to learn fundamentals of full stack engineering for web products?
- **CLI work in IDE:** How can we make sure the code mode works well in IDE as that’s more honest than CLI only.
- **IDE plugin:** what would a more full tutor experience look like with an IDE plugin for VS code or cursor?
