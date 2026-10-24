import { SelectField, TextField } from "@blocks/command/fields";
import { Form } from "@blocks/command/form";
import { ReferenceSelect } from "@blocks/query/reference-select";
import { Page } from "@blocks/shell/page";
import { Stepper } from "@blocks/shell/stepper";
import { collectionQueryOptions, useCommandForm, useSubscription } from "@lynx-go/ui-kit";
import type { Segment } from "@lynx-go/ui-kit/kernel";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createWaitRun,
  createWaitTransport,
  type Project,
  projectsResource,
  type WaitFrame,
  type Workload,
  workloadsResource,
} from "@/lib/quickstart";

export const Route = createFileRoute("/quickstart")({
  component: QuickstartPage,
});

/**
 * 向导配方（design.md §6.3）：Stepper[ n × Form | 等待步骤 ]。
 *
 * - 步 1/2 是 Form（ensure 幂等语义——quickstart 实证）；步间衔接走 fresh-read
 *   （fetchQuery staleTime:0 绕过 stale 缓存，§3 多请求编排——步 2 的项目选择器
 *   拿到的是步 1 刚创建的项目）；
 * - 步 3 是等待步骤：wait 流（订阅帧到终态 → 前进；帧优先于轮询）；
 * - 步进由事件驱动（提交/终态帧），Stepper 受控不自决。
 */
function QuickstartPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [waitState, setWaitState] = useState<WaitFrame | null>(null);

  const steps = [
    { key: "project", label: "Project" },
    { key: "workload", label: "Workload" },
    { key: "deploy", label: "Deploy" },
    { key: "done", label: "Done" },
  ];

  // —— 步 1：ensure project（幂等） + fresh-read 项目面 ——
  const projectForm = useCommandForm(projectsResource.commands!.ensure, {
    defaultValues: { name: "" },
    onSettled: async (result) => {
      if (result?.status !== "ok") return;
      setProject(result.payload);
      // fresh-read：绕过 stale 缓存重读项目面（步 2 的选择器即刻可见新项目）
      await queryClient.fetchQuery<Segment<Project>, Error>(
        collectionQueryOptions(projectsResource, { window: { size: 100 } }, { staleTime: 0 }),
      );
      setStep(1);
    },
  });

  // —— 步 2：create workload（挂选定项目；projectId 是语境值非字段——经表单 store 注入） ——
  const workloadForm = useCommandForm(workloadsResource.commands!.create, {
    defaultValues: { name: "", projectId: "", replicas: 2 },
    onSettled: (result) => {
      if (result?.status !== "ok") return;
      setWorkload(result.payload);
      setStep(2);
    },
  });
  useEffect(() => {
    if (project) void workloadForm.form.setFieldValue("projectId", project.id);
  }, [project, workloadForm.form]);

  // —— 步 3：等待步骤（wait 流帧驱动；终态帧前进） ——
  const [waitTransport] = useState(() => createWaitTransport());
  const [waitRun] = useState(() => createWaitRun(waitTransport));
  const sub = useSubscription(waitTransport, {
    cursor: null,
    autoStart: false,
    onFrame: (frame) => {
      setWaitState(frame);
      if (frame.state !== "provisioning") setStep(3);
    },
  });
  useEffect(() => {
    if (step === 2 && sub.status !== "live") {
      waitRun.run();
      sub.start();
    }
  }, [step, sub, waitRun]);
  useEffect(() => () => waitRun.stop(), [waitRun]);

  const reset = () => {
    waitRun.stop();
    setStep(0);
    setProject(null);
    setWorkload(null);
    setWaitState(null);
  };

  return (
    <Page
      title="Quickstart — wizard recipe"
      description="Stepper[ n × Form | wait step ] — idempotent ensure, fresh-read hand-off, wait stream to terminal state."
      width="narrow"
    >
      <Stepper steps={steps} current={step} onStepClick={(index) => index < step && setStep(index)}>
        {step === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Step 1 — ensure project (idempotent: an existing name is reused, not duplicated).
            </p>
            <Form
              form={projectForm.form}
              submitting={projectForm.submitting}
              result={projectForm.result}
            >
              <TextField
                form={projectForm.form}
                name="name"
                label="Project name"
                placeholder="acme-prod"
              />
            </Form>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Step 2 — workload in project <b>{project?.name}</b>. The picker reads the project
              fresh-read in step 1 (fetchQuery, staleTime 0).
            </p>
            <Form
              form={workloadForm.form}
              submitting={workloadForm.submitting}
              result={workloadForm.result}
              submitLabel="Create & deploy"
            >
              <TextField
                form={workloadForm.form}
                name="name"
                label="Workload name"
                placeholder="api"
              />
              <SelectField
                form={workloadForm.form}
                name="replicas"
                label="Replicas"
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <ReferenceSelect
                resource={projectsResource}
                getLabel={(row) => row.name}
                getValue={(row) => row.id}
                value={project?.id ?? null}
                onChange={(id) => {
                  const found = queryClient
                    .getQueryData<Segment<Project>>(
                      collectionQueryOptions(projectsResource, { window: { size: 100 } }).queryKey,
                    )
                    ?.rows.find((p) => p.id === id);
                  if (found) setProject(found);
                }}
                placeholder="Switch project…"
              />
            </Form>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3 rounded-md border border-line p-4" data-testid="wait-step">
            <p className="text-xs text-muted">
              Step 3 — wait stream (frames to terminal state; no polling). Status:{" "}
              <b data-testid="wait-status">{sub.status}</b>
            </p>
            <div className="flex items-center gap-2 text-sm" data-testid="wait-frame">
              {waitState ? (
                <>
                  <span className="font-medium capitalize">{waitState.state}</span>
                  <span className="text-muted">{waitState.detail}</span>
                </>
              ) : (
                <span className="text-muted">connecting…</span>
              )}
            </div>
            {workload ? (
              <p className="text-xs text-muted">
                Rolling out {workload.replicas} replicas of <b>{workload.name}</b>.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div
            className="space-y-3 rounded-md border border-ok/40 bg-ok/5 p-4"
            data-testid="wizard-done"
          >
            <p className="text-sm font-medium text-ok">Workload is healthy.</p>
            <p className="text-xs text-muted" data-testid="wizard-summary">
              {project?.name}/{workload?.name} · {waitState?.detail ?? "probes passing"}
            </p>
            <p className="font-mono text-xs text-accent" data-testid="wizard-url">
              https://{workload?.name}.sslip.io
            </p>
            <Button size="sm" variant="outline" onClick={reset}>
              Start over
            </Button>
          </div>
        ) : null}
      </Stepper>
    </Page>
  );
}
