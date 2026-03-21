import { ArrowDown } from "lucide-react"

interface HierarchyAgent {
  name: string
  role: string
  color: string
  model: string
}

interface AgentHierarchyProps {
  agents: HierarchyAgent[]
}

export function AgentHierarchy({ agents }: AgentHierarchyProps) {
  const orchestrator = agents.find((a) => a.role === "ORCHESTRATOR")
  const workers = agents.filter((a) => a.role === "WORKER")
  const critic = agents.find((a) => a.role === "CRITIC")

  return (
    <div className="flex flex-col items-center gap-1.5 my-3">
      {orchestrator && (
        <div className="bg-[var(--acbg)] border-2 border-[var(--ac)] rounded-[8px] py-2 px-[18px] text-center min-w-[180px]">
          <div className="text-[9px] font-semibold text-[var(--ac)] uppercase tracking-[0.5px]">Orchestrator</div>
          <div className="text-[13px] font-semibold">{orchestrator.name}</div>
          <div className="text-[10px] text-[var(--tx2)]">{orchestrator.model.split("/")[1]}</div>
        </div>
      )}

      <ArrowDown className="w-3.5 h-3.5 text-[var(--tx3)]" />

      <div className="flex gap-1.5 flex-wrap justify-center">
        {workers.map((worker) => (
          <div
            key={worker.name}
            className="border border-[var(--bd)] rounded-[8px] py-1.5 px-3 text-center min-w-[100px] border-l-[3px]"
            style={{ borderLeftColor: worker.color }}
          >
            <div className="text-[11px] font-semibold">{worker.name}</div>
            <div className="text-[9px] text-[var(--tx2)]">{worker.model.split("/")[1]}</div>
          </div>
        ))}
      </div>

      <ArrowDown className="w-3.5 h-3.5 text-[var(--tx3)]" />

      {critic && (
        <div className="bg-[#ede9fe] border-2 border-[#8b5cf6] rounded-[8px] py-2 px-[18px] text-center min-w-[180px]">
          <div className="text-[9px] font-semibold text-[#5b21b6] uppercase tracking-[0.5px]">Critic</div>
          <div className="text-[13px] font-semibold text-[#5b21b6]">{critic.name}</div>
          <div className="text-[10px] text-[#7c3aed]">{critic.model.split("/")[1]}</div>
        </div>
      )}
    </div>
  )
}
