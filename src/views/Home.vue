<template>
  <div class="home">
    <form @submit.prevent="debugQuery">
      <label>
        <span>Schema:</span>
        <input v-model="tableSchema" />
      </label>
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
      <monaco-editor ref="editor"
        v-model="content"
        class="editor"
        language="sql"
        @editorWillMount="editorWillMount" />

      <input
        class="debug-query-btn"
        type="submit"
        value="Debug Query"
      />
    </form>
  </div>
</template>

<script>
// @ is an alias to /src
import electron from "electron";
import MonacoEditor from 'vue-monaco';

export default {
  name: "Home",
  components: {
    MonacoEditor,
  },
  mounted() {
    window.addEventListener('resize', this.resizeListener);
  },
  unmounted() {
    window.removeEventListener('resize', this.resizeListener);
  },
  data() {
    return {
      tableSchema: "public",
      tableName: "stories",
      tableColumn: "id",
      tableColumnValue: 1283022,
      monaco: null,
      decorations: [],
      decorationIds: [],
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
    };
  },
  computed: {
    editor() {
      return this.$refs.editor.getEditor();
    }
  },
  watch: {
    content() {
      this.clearMarkers();
    }
  },
  methods: {
    resizeListener() {
      this.editor.layout();
    },
    editorWillMount(monaco) {
      this.monaco = monaco;
    },
    debugQuery() {
      electron.ipcRenderer.invoke('why-missing', [
        this.tableSchema, this.tableName, this.tableColumn, this.tableColumnValue, this.content
      ]);

      electron.ipcRenderer.once('why-missing-replay', (event, {join, where}) => {
        this.highlightProblems(join);
        this.highlightProblems(where);
      });

      electron.ipcRenderer.once('why-missing-failed', (event, message) => {
        alert(message);
      })
    },
    highlightProblems(problems) {
      let first = null;

      problems.forEach((problem, i) => {
        let model = this.editor.getModel();
        let start = model.getPositionAt(problem[0]);
        let end   = model.getPositionAt(problem[1]);

        if (i === 0) {
          first = start;
        }

        let range = new this.monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
        let options = {
          className: 'why-missing-problem',
          hoverMessage: 'The record is missing in the resulset because this condition is false'
        };

        this.decorations.push({ range, options });

        this.decorationIds = this.editor.deltaDecorations(this.decorationIds, this.decorations);
      });

      if (first) {
        this.editor.revealLineInCenter(first.lineNumber);
      }
    },
    clearMarkers() {
      this.editor.deltaDecorations(this.decorationIds, []);
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

  .editor {
    width: 100%;
    height: 40vh;
  }

  .why-missing-problem {
    position: absolute;
    background: red;
    opacity: 0.4;
  }
}
</style>
