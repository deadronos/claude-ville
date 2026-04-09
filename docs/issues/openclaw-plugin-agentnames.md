OpenClaw doesnt automatically recognize the correct agentids


Openclaw has ~/.openclaw/agents/[agentid]/sessions
so agent "clawson" would have sessions in ~/.openclaw/agents/clawson/sessions
agent reseacher would have sessions in ~/.openclaw/agents/researcher/sessions

the plugin should automatically name the agent in the dashboard based on the agentid in the path, but it currently just names all agents "agent" which is not helpful when you have multiple agents.