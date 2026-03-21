interface ChannelListProps {
  children: React.ReactNode
}

export function ChannelList({ children }: ChannelListProps) {
  return (
    <div className="border border-[var(--bd)] rounded-xl overflow-hidden">
      {children}
    </div>
  )
}
