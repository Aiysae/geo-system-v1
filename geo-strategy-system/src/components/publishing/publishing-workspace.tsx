"use client"

import { WorkspaceSessionGate } from "@/components/auth/authenticated-app-shell"
import PublishingConsole from "./publishing-console"

export default function PublishingWorkspace() {
  return (
    <WorkspaceSessionGate redirectPath="/publishing" launchOnboarding={false}>
      {({ access, notifiers }) => <PublishingConsole access={access} notifiers={notifiers} />}
    </WorkspaceSessionGate>
  )
}
