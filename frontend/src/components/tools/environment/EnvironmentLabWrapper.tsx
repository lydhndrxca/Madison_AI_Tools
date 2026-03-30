import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { EnvironmentPage } from "./EnvironmentPage";

export function EnvironmentLabWrapper() {
  return (
    <ProjectTabsWrapper storageKey="madison-envlab-projects" defaultProjectName="Project">
      {({ instanceId, active, projectUid }) => (
        <EnvironmentPage instanceId={instanceId} active={active} projectUid={projectUid} />
      )}
    </ProjectTabsWrapper>
  );
}
