"""One-off seed for eyeballing the JV-partner print/PDF export.

Creates a project with 15 rigs (5 per terrain), 60 activities spanning 2026–2036
(durations 30–180 days), varied readiness/risk/plan-type, and 3 reviewers + 3
approvers who have all signed — so Rev 1 is APPROVED and the print's sign-off
table is fully populated.

Run from backend/:   .venv/bin/python scripts/seed_print_demo.py

Dev tool: it writes to whatever database `app` is configured against, so point it
at a throwaway/dev DB — never a real one. Not used by the tests or the app.
"""
import asyncio
import json
import random
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.project import Project, ProjectMember, ProjectRole, ProjectStatus
from app.models.readiness import ReadinessCheck
from app.models.revision import Revision, Signature
from app.models.rig_contract import RigContract
from app.models.user import User
from app.services.snapshot import build_project_snapshot

RNG = random.Random(20260601)
DEV_OID = "00000000-0000-0000-0000-000000000001"

SPAN_START = date(2026, 1, 1)
SPAN_END = date(2036, 12, 31)

# Activity types with distinct colours in the frontend palette, so the legend shows variety.
ACTIVITY_TYPES = [
    "Oil Development", "Oil Exploration", "Oil Appraisal", "Oil Workover",
    "Gas Development", "Gas Exploration", "Gas Appraisal", "Gas Sidetrack",
    "Water Injection", "HPHT(Development)", "Abandonment", "Well Repair/Safety",
]
WELL_PREFIXES = ["KANB", "NUNR", "OGUT", "BELE", "SOKU", "GBAR", "AGAH", "EGBM",
                 "OKWE", "IBAF", "UGHE", "ZARM", "TUNB", "FORC", "BONG", "SEAE"]
PLAN_WEIGHTED = ["Firm", "Firm", "Firm", "Firm", "Option", "Option", "Out of Plan"]
RISK_WEIGHTED = ["Low", "Low", "Low", "Medium", "Medium", "High"]
GATE_STORED = ["BUD", "LLI", "LOC", "FID", "EIA", "FLOOD", "SUBS"]  # CON is derived from the contract
GATE_STATUS_WEIGHTED = ["Completed", "Completed", "In Progress", "Behind", "Not Started", "N/A"]

# 5 rigs per terrain → 15 rigs. Each rig belongs to exactly one terrain.
RIGS = {
    "LAND": ["Elohor 101", "Elohor 102", "Elohor 103", "Jack Hardy", "Otumara 7"],
    "SWAMP": ["Swamp Fox 1", "Swamp Fox 2", "18K Rig", "Mangrove", "Delta Queen"],
    "OFFSHORE": ["Bonga FPSO", "Sea Eagle", "Deep Blue", "Oloibiri", "Trident 8"],
}

REVIEWERS = [
    ("ada.obi@renaissanceafrica.com", "Ada Obi", "Drilling Manager"),
    ("tunde.bello@renaissanceafrica.com", "Tunde Bello", "Subsurface Manager"),
    ("ngozi.eze@renaissanceafrica.com", "Ngozi Eze", "Wells Engineering Lead"),
]
APPROVERS = [
    ("dare.kehinde@renaissanceafrica.com", "Dare Kehinde", "GM Strategy & Planning"),
    ("ifeoma.okafor@renaissanceafrica.com", "Ifeoma Okafor", "VP Operations"),
    ("musa.danjuma@renaissanceafrica.com", "Musa Danjuma", "Managing Director"),
]


async def _get_or_make_user(db, email: str, name: str) -> User:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(ad_object_id=f"seed-{uuid.uuid4()}", name=name, email=email, is_admin=False)
        db.add(user)
        await db.flush()
    return user


async def main() -> None:
    async with AsyncSessionLocal() as db:
        # 1. Planner / creator — reuse the dev user the frontend logs in as.
        dev = (
            await db.execute(select(User).where(User.ad_object_id == DEV_OID))
        ).scalar_one_or_none()
        if dev is None:
            dev = User(ad_object_id=DEV_OID, name="Dev User", email="dev@company.com", is_admin=True)
            db.add(dev)
            await db.flush()

        # 2. Project (planner-owned, review required so the review matrix is in play).
        proj = Project(
            name="Q3 Rig Sequence — Print Demo",
            field="OML 118",
            region="Niger Delta",
            status=ProjectStatus.active,
            created_by=dev.id,
            review_policy="required",
        )
        db.add(proj)
        await db.flush()
        db.add(ProjectMember(project_id=proj.id, user_id=dev.id, role=ProjectRole.planner))

        # 3. Rigs + contracts. Vary contract_end so the derived CON gate differs
        #    (rigs ending mid-decade leave their later activities "Behind").
        for terrain, rigs in RIGS.items():
            for rig in rigs:
                end_year = RNG.choice([2030, 2033, 2037, 2041])
                db.add(
                    RigContract(
                        project_id=proj.id,
                        rig_name=rig,
                        status="Completed",
                        contract_start=date(2026, 1, 1),
                        contract_end=date(end_year, 6, 30),
                    )
                )

        # 4. 60 activities — 4 per rig, each in its own ~2.7-year segment so bars on a
        #    rig row never overlap; durations 30–180 days.
        rig_terrain = [(t, r) for t, rigs in RIGS.items() for r in rigs]  # 15 rigs
        total_days = (SPAN_END - SPAN_START).days
        seg = total_days // 4
        well_counter: dict[str, int] = {}
        made = 0
        for terrain, rig in rig_terrain:
            for j in range(4):
                seg_start = SPAN_START + timedelta(days=j * seg)
                dur = RNG.randint(30, 180)
                jitter = RNG.randint(0, max(1, seg - 200))
                start = seg_start + timedelta(days=jitter)
                latest_start = SPAN_END - timedelta(days=dur)
                if start > latest_start:
                    start = latest_start
                end = start + timedelta(days=dur)
                pref = RNG.choice(WELL_PREFIXES)
                well_counter[pref] = well_counter.get(pref, 0) + 1
                well = f"{pref}{well_counter[pref]:03d}"
                act = Activity(
                    project_id=proj.id,
                    activity_type=RNG.choice(ACTIVITY_TYPES),
                    start_date=start,
                    end_date=end,
                    well_name=well,
                    rig_name=rig,
                    location=terrain,
                    plan_type=RNG.choice(PLAN_WEIGHTED),
                    risk=RNG.choice(RISK_WEIGHTED),
                )
                db.add(act)
                await db.flush()
                for code in GATE_STORED:
                    db.add(
                        ReadinessCheck(
                            activity_id=act.id,
                            check_code=code,
                            status=RNG.choice(GATE_STATUS_WEIGHTED),
                        )
                    )
                made += 1

        await db.flush()

        # 5. Build the frozen snapshot exactly as the app does, and approve Rev 1.
        snapshot = await build_project_snapshot(proj.id, db)
        rev = Revision(
            project_id=proj.id,
            rev_number=1,
            label="Q3 Sequence",
            snapshot_json=json.dumps(snapshot),
            status="approved",
            review_required=True,
            created_by=dev.id,
            created_at=datetime(2026, 5, 20, 9, 0, tzinfo=timezone.utc),
        )
        db.add(rev)
        await db.flush()

        # 6. Reviewers then approvers — designated signers + their cast signatures.
        signed_at = datetime(2026, 5, 25, 10, 0, tzinfo=timezone.utc)
        for email, name, role in REVIEWERS:
            u = await _get_or_make_user(db, email, name)
            db.add(ProjectApprover(project_id=proj.id, email=email, name=name, role_label=role, kind="reviewer"))
            db.add(Signature(revision_id=rev.id, user_id=u.id, role_label=role, stage="review", signed_at=signed_at))
            signed_at += timedelta(hours=4)
        for email, name, role in APPROVERS:
            u = await _get_or_make_user(db, email, name)
            db.add(ProjectApprover(project_id=proj.id, email=email, name=name, role_label=role, kind="approver"))
            db.add(Signature(revision_id=rev.id, user_id=u.id, role_label=role, stage="approval", signed_at=signed_at))
            signed_at += timedelta(hours=6)

        await db.commit()

        print(f"Seeded project {proj.id!s}")
        print(f"  activities: {made}")
        print(f"  rigs: {len(rig_terrain)} (5 per terrain)")
        print(f"  revision: {rev.id!s} (rev 1, approved)")
        print(f"  reviewers: {len(REVIEWERS)}  approvers: {len(APPROVERS)}")
        print(f"  open: http://localhost:5173/projects/{proj.id!s}/revisions/{rev.id!s}")


if __name__ == "__main__":
    asyncio.run(main())
