import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProjectsStore } from "@/store/projects";
import type { Project } from "@/types";

const schema = z.object({
  name: z.string().min(1, "Project name is required").max(256),
  field: z.string().max(256).optional(),
  region: z.string().max(256).optional(),
});

type FormValues = z.infer<typeof schema>;

interface CloneProjectDialogProps {
  project: Project;
}

export function CloneProjectDialog({ project }: CloneProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cloneProject = useProjectsStore((s) => s.cloneProject);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: `${project.name} (copy)`,
      field: project.field ?? undefined,
      region: project.region ?? undefined,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const clone = await cloneProject(project.id, values);
      setOpen(false);
      reset();
      navigate(`/projects/${clone.id}/overview`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
          title="Duplicate as new sequence"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Duplicate Drilling Sequence</DialogTitle>
          <DialogDescription>
            Copies activities, readiness checks, and required approvers. Dates are kept
            as-is and the approval history starts fresh.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="clone-name">New sequence name *</Label>
            <Input
              id="clone-name"
              placeholder="e.g. Q3 rig Sequence"
              {...register("name")}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clone-field">Field</Label>
              <Input id="clone-field" placeholder="e.g. Bonga" {...register("field")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clone-region">Region</Label>
              <Input id="clone-region" placeholder="e.g. Offshore" {...register("region")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
