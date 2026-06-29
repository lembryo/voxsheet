# Changesets

このフォルダは [Changesets](https://github.com/changesets/changesets) が管理します。

変更を加えたら `npm run changeset` を実行し、変更内容と semver の影響（patch / minor / major）を記録してください。`main`
にマージされると、Release ワークフローが「Version Packages」PR を作成し、その PR をマージすると npm へ公開されます。
