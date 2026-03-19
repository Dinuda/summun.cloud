Integrate meta ads


What is needed to be achieved from a customer standpoint:

1. Add webhook endpoints for meta ads
2. Data shows up on summun dashboard. 
3. Action items are created and approved, by an agent. 


What needs to happen technically. 

1. Create webhook endpoints for meta ads in the server.
2. Create a service to process the incoming data from meta ads and store it in the database
3. Create a dashboard component to display the meta ads data.
4. Create a workflow for agents to review and approve action items based on the meta ads data
5. Implement notifications for agents when new action items are created from meta ads data.

What happens in the backend:

1. Use a workflow service to create a workflow for processing meta ads data and creating action items. (Temporal)
2. There needs to be a database structure. That is abstract. Not relating specifically for this problem domain, but it should be able to store the meta ads data and the action items created from it.
3. The workflow and action items can have seperate database tables, but they should be linked together.
4. The workflow will be responsible for processing the incoming meta ads data, creating action items,
5. Use a new agent to review and approve the action items created from meta ads data. This agent can be triggered by a notification when new action items are created. (These must be all dynimically configurable on the frontend)



Come up with a plan to implement this layer by layer, testable and iterative.