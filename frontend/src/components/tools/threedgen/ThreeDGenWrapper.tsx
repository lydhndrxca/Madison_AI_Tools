import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { ThreeDGenPage } from "./ThreeDGenPage";

export function ThreeDGenWrapper({ visible }: { visible?: boolean }) {
  return (
    <ProjectTabsWrapper storageKey="madison-3dgen-projects" defaultProjectName="Project">
      {({ instanceId, active, projectUid }) => (
        <ThreeDGenPage
          visible={visible !== false && active}
          instanceId={instanceId}
          projectUid={projectUid}
        />
      )}
    </ProjectTabsWrapper>
  );
}
