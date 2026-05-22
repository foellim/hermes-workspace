import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { EprPendingsScreen } from '@/screens/epr-pendings/epr-pendings-screen'

export const Route = createFileRoute('/epr-pendings')({
  ssr: false,
  component: EprPendingsRoute,
})

function EprPendingsRoute() {
  usePageTitle('EPR Pendings')
  return <EprPendingsScreen />
}
