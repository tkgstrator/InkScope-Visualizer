import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function FlatCard({ title, meta, children, className = "" }: {
  title: string
  meta?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={`gap-0 rounded-md border shadow-none ring-0 ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b py-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider">{title}</CardTitle>
        {meta && <span className="font-mono text-xs text-muted-foreground">{meta}</span>}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  )
}
