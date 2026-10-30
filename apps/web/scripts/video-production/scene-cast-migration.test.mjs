import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {DatabaseSync} from "node:sqlite";

const migration=fileURLToPath(new URL("../../../../migrations/0021_project_scene_cast.sql",import.meta.url));

test("SQLite scene cast migration accepts an exact source revision and rejects duplicate/stale invalid data",async()=>{
  const db=new DatabaseSync(":memory:");
  try{
    db.exec(await readFile(migration,"utf8"));
    const insert=db.prepare("INSERT INTO project_scene_cast (project_id, source_plan_sha256, revision, cast_json, updated_at) VALUES (?, ?, ?, ?, ?)");
    const sha="a".repeat(64),document=JSON.stringify({schemaVersion:1,projectId:"p1",sourcePlanSha256:sha,assignments:[]});
    insert.run("p1",sha,1,document,"2026-10-28T00:00:00Z");
    assert.throws(()=>insert.run("p1",sha,1,document,"2026-10-28T00:00:00Z"),/UNIQUE constraint/u);
    assert.throws(()=>insert.run("p1","short",1,document,"2026-10-28T00:00:00Z"),/CHECK constraint/u);
    assert.throws(()=>insert.run("p2",sha,0,document,"2026-10-28T00:00:00Z"),/CHECK constraint/u);
    assert.throws(()=>insert.run("p2",sha,1,"bad-json","2026-10-28T00:00:00Z"),/CHECK constraint/u);
    const cas=db.prepare("UPDATE project_scene_cast SET revision = revision + 1, cast_json = ? WHERE project_id = ? AND source_plan_sha256 = ? AND revision = ?");
    assert.equal(cas.run(document,"p1",sha,1).changes,1);
    assert.equal(cas.run(document,"p1",sha,1).changes,0,"stale writer must not overwrite the newer cast");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  }finally{db.close();}
});
