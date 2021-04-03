<template>
  <div class="home">
    <form @submit.prevent="debugQuery">
      <label>
        <span>Table:</span>
        <input v-model="tableName" />
      </label>
      <label>
        <span>Column:</span>
        <input v-model="tableColumn" />
      </label>
      <label>
        <span>Value:</span>
        <input v-model="tableColumnValue" />
      </label>

      <textarea v-model="content"></textarea>

      <input
        class="debug-query-btn"
        type="submit"
        value="Debug Query"
      />
    </form>
    <!-- <v-ace-editor
      @init="setEditor"
      @change="clearMarkers"
      v-model="content"
      :options="aceOptions"
      lang="sql"
      theme="monokai"
      height="50vh"
    /> -->
  </div>
</template>

<script>
// @ is an alias to /src
// import whyMissing from "@/backend/why-missing";
import electron from "electron";
// import { parseFirst } from "pgsql-ast-parser";

export default {
  name: "Home",
  data() {
    return {
      tableName: "",
      tableColumn: "",
      tableColumnValue: null,
      editor: null,
      content: `
        SELECT
    *
    FROM
    "stories"
    LEFT JOIN "overrides" ON
    "stories"."id" = overrides.story_id
    AND overrides.pool_id = 5
    LEFT JOIN "owner_story" ON
    "stories"."id" = owner_story.story_id
    AND owner_story.owner_id = 17958
    WHERE
    "stories"."pool_id" = 5
    AND NOT EXISTS (
    SELECT
        *
    FROM
        "regions"
    INNER JOIN "region_story" ON
        "regions"."id" = "region_story"."region_id"
    WHERE
        "region_story"."story_id" = "stories"."id"
        AND "regions"."deleted_at" IS NULL)
    AND "stories"."id" IN (1283022)
    AND EXISTS (
    SELECT
        *
    FROM
        "platform_story"
    WHERE
        "story_id" = stories.id
        AND "platform_id" IN (1)
        AND "platform_id" = owner_story.platform_id
        AND "enabled" = true)
    AND ("expires_at" IS NULL
    OR "expires_at" > '2021-03-31 18:52:09')
    AND EXISTS (
    SELECT
        *
    FROM
        "classifier_story"
    WHERE
        "classifier_id" IN (1141, 1142)
        AND "story_id" = stories.id)
    AND EXISTS (
    SELECT
        *
    FROM
        "campaigns"
    INNER JOIN "campaign_story" ON
        "campaigns"."id" = "campaign_story"."campaign_id"
    WHERE
        "campaign_story"."story_id" = "stories"."id"
        AND "campaigns"."id" IN (283)
        AND "campaigns"."deleted_at" IS NULL)
    AND "owner_story"."platform_id" = 1
    AND (
        1 = 2
        AND 1=3
        AND ("owner_story"."type" IS NULL OR "owner_story"."deleted_at" IS NOT NULL)
    )
    AND "stories"."deleted_at" IS NULL
    ORDER BY
    "stories"."published_at" DESC,
    "stories"."id" DESC
      `,
      errorMarkers: [],
      aceOptions: {
        fontFamily: "Source Code Pro",
        fontSize: 16,
        tabSize: 2,
      },
    };
  },
  methods: {
    debugQuery() {
      // this.clearMarkers();

      // let session = this.editor.getSession();
      // let range = new ace.Range(1, 0, 1, 1);

      // // console.log(session.getTextRange(range));
      // let markerID = session.addMarker(range, "test-class", "text", false);

      // this.errorMarkers.push(markerID);

      // console.log(this.content.split("\n"));
      // whyMissing.findProblems("stories", "id", 1283022, this.content);
      electron.ipcRenderer.invoke('why-missing', [
        "stories", "id", 1283022, this.content
        // "pp", "id", 234505, this.content
      ]);

      electron.ipcRenderer.once('why-missing-replay', function() {
        // TODO: improve indexes
        console.log(arguments);
      });
    },
    setEditor(editor) {
      this.editor = editor;
    },
    clearMarkers() {
      let session = this.editor.getSession();
      this.errorMarkers.forEach((marker) => {
        session.removeMarker(marker);
      });
    },
  },
};
</script>
<style lang="scss">
.home {
  form {
    margin-bottom: 1em;
    label {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      margin-bottom: 0.25em;
    }
  }

  .test-class {
    position: absolute;
    background: red;
    opacity: 0.4;
  }
}
</style>
